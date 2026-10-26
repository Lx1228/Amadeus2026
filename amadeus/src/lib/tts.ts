import { getSessionCharacterId } from "./auth";
import { loadVoiceClipsEnabled, matchVoiceClip, voiceClipUrl } from "./voice-clips";
import { matchCatchphrase, pickCatchphraseUrl } from "./catchphrase";
import type { EmotionType } from "./emotion";
import { log } from "@/lib/debug-log";
import {
  CLOUD_MODEL,
  clearCloudVoice,
  loadAliyunKey,
  loadCloudVoices,
  saveCloudVoice,
} from "./cloud-tts";

const TTS_STORAGE_KEY = "amadeus_tts_config";

// 2026-10-25：本地语音模型（tts-local / Qwen3-TTS，9880）整个功能已删除，
// 语音合成只走云端（阿里云百炼 CosyVoice，粉丝自带 Key）。
// 历史遗留的 localStorage key（amadeus_tts_local_endpoint 等）不再读写，留着无害。

export interface TTSConfig {
  enabled: boolean;
  autoPlay: boolean;
}

// === 存储函数 ===

export function loadTTSConfig(): TTSConfig {
  if (typeof window === "undefined") return { enabled: false, autoPlay: true };
  const saved = localStorage.getItem(TTS_STORAGE_KEY);
  const parsed = saved ? JSON.parse(saved) : { enabled: false };
  return { enabled: !!parsed.enabled, autoPlay: true };
}

export function saveTTSConfig(config: TTSConfig) {
  localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(config));
}

// === 合成 ===

/**
 * 可播放的音频。
 * - url：音频文件地址（原声片段）
 * - base64：base64 数据（本地服务返回 wav）
 * - segments：流式模式下的分段音频（每段独立可播，用于无缝排队播放）
 */
export interface PlayableAudio {
  url?: string;
  base64?: string;
  format?: string;
  /** 流式分段：按顺序播放，实现"第一句先开口" */
  segments?: string[];
}

/** 播放队列里的单个音源 */
interface AudioSource {
  url?: string;
  base64?: string;
  format?: string;
}

// === 当前正在播放的音频元素（供挂断/打断时立即停止）===
let activeAudioEl: HTMLAudioElement | null = null;

/**
 * 播放会话序号。
 *
 * ⚠️ 2026-10-18 修：口型「只有第一句动」的根因就是 tts-start/tts-end 无归属。
 * 上一句结束时会派发 tts-end，如果它晚于下一句的 tts-start 到达（实测只差 1ms），
 * Live2D 会立刻把 isSpeaking 置 false —— 整句都不张嘴。
 * 现在每个 start/end 都带 token，Live2D 只认自己那次会话的 end。
 */
let ttsSessionToken = 0;

/**
 * 当前分段播放链的控制句柄（流式播放时非空）。
 * 用 var 提前声明：stopCurrentAudio() 写在这个变量声明之前，
 * 如果用 let 会在模块初始化阶段触发 TDZ。
 */
var activeSegmentChain: { stopped: boolean; audio: HTMLAudioElement | null } | null = null;

/** 立即停止当前正在播放的 TTS 音频，并复位 Live2D 口型。供通话挂断等场景调用。 */
export function stopCurrentAudio() {
  // 分段流式播放：先置停止标记，让 playNext 链条不再往下走
  if (activeSegmentChain) {
    activeSegmentChain.stopped = true;
    const segAudio = activeSegmentChain.audio;
    activeSegmentChain = null;
    if (segAudio) {
      try { segAudio.pause(); } catch { /* 忽略 */ }
      try { segAudio.src = ""; } catch { /* 忽略 */ }
    }
  }
  if (activeAudioEl) {
    try { activeAudioEl.pause(); } catch { /* 忽略 */ }
    try { activeAudioEl.src = ""; } catch { /* 忽略 */ }
    activeAudioEl = null;
    window.dispatchEvent(new CustomEvent("amadeus-tts-end", { detail: { token: ttsSessionToken } }));
  }
}

export function stripParentheses(text: string): string {
  return text.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 清理 TTS 文本，避免引擎读错。
 * 1. 省略号 `...` / `…` 会被读成奇怪的音 → 换成句号
 * 2. 波浪号会被读成颤音 → 去掉
 * 3. 多余换行/空格会被当内容朗读 → 合并
 * 4. 末尾无标点时引擎会补拖音 → 补句号
 */
export function cleanTTSText(text: string): string {
  let t = text;
  t = t.replace(/\.{3,}/g, "。");
  t = t.replace(/…/g, "。");
  t = t.replace(/。{2,}/g, "。");
  t = t.replace(/~/g, "");
  t = t.replace(/〜/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t && !/[。！？!?\.]$/.test(t)) {
    t = t + "。";
  }
  return t;
}

// ================= 云端语音（阿里云 CosyVoice，2026-10-19） =================
// 粉丝自带 Key：首次复刻三个音色（免费），之后每次合成按字符计费。
// 云端不流式（官方 HTTP 接口是整段返回 OSS 链接），所以这里整段取回 base64 mp3。

/** 确保该角色有云端音色；缓存里没有就现场复刻一次 */
async function ensureCloudVoice(characterId: string, apiKey: string): Promise<string | null> {
  const cached = loadCloudVoices()[characterId];
  if (cached) return cached;
  try {
    const res = await fetch("/api/tts/cloud/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, apiKey }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.voiceId) {
      console.error("[云端语音] 音色复刻失败:", data.error || `HTTP ${res.status}`);
      return null;
    }
    saveCloudVoice(characterId, String(data.voiceId));
    console.log(`[云端语音] 音色已复刻 ${characterId} → ${data.voiceId}`);
    return String(data.voiceId);
  } catch (e) {
    console.error("[云端语音] 音色复刻异常:", e);
    return null;
  }
}

/** 云端整段合成；音色失效时自动重新复刻重试一次 */
async function synthesizeCloud(text: string, characterId: string): Promise<PlayableAudio | null> {
  const apiKey = loadAliyunKey().trim();
  if (!apiKey) {
    console.warn("[云端语音] 未配置阿里云 API Key（设置 → 语音合成）");
    return null;
  }
  let voiceId = await ensureCloudVoice(characterId, apiKey);
  if (!voiceId) return null;

  const call = async (voice: string) => {
    const res = await fetch("/api/tts/cloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId: voice, apiKey }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  let r = await call(voiceId);
  if (!r.ok && /voice|音色|INVALID|NotFound|NO_VOICE/i.test(String(r.data?.code || "") + String(r.data?.error || ""))) {
    console.warn("[云端语音] 音色疑似失效，重新复刻后重试:", r.data?.error);
    clearCloudVoice(characterId);
    const again = await ensureCloudVoice(characterId, apiKey);
    if (again) r = await call(again);
  }
  if (!r.ok || !r.data?.audio) {
    console.error("[云端语音] 合成失败:", r.data?.error || "未知错误");
    return null;
  }
  log(`[云端语音] 合成成功（${CLOUD_MODEL}，${r.data.characters || "?"} 字符）`);
  return { base64: r.data.audio as string, format: "mp3" };
}

/**
 * 合成语音（流式接口，云端引擎整段返回后作为"单段"回调）。
 *
 * 历史说明：本地引擎时代这里走 /api/tts 的 SSE 流式接口，第一段到达就回调
 * onFirstSegment 实现"边想边说"。2026-10-25 本地模型功能删除，云端 CosyVoice
 * 是整段返回，没有"首段提前"可做 —— onFirstSegment 参数保留但不再触发，
 * 调用方无需改动。
 *
 * @param onFirstSegment 保留参数（云端整段返回，不再触发）
 */
export async function synthesizeSpeechStream(
  text: string,
  ttsConfig: TTSConfig,
  emotion?: EmotionType,
  onFirstSegment?: (segmentBase64: string) => void
): Promise<PlayableAudio | null> {
  void onFirstSegment;
  return synthesizeSpeech(text, ttsConfig, emotion);
}

/**
 * 合成语音（非流式，整句返回）。
 *
 * 2026-10-25 本地模型功能删除：只走云端 CosyVoice 整段合成。
 *
 * @param emotion LLM 回复里带的情绪标签（neutral/blush/smile/angry/sad）。
 *                本地引擎时代它映射成 8 维情感向量；云端 CosyVoice 不吃这个
 *                参数，保留签名是为了调用方不动。
 *
 * 经典台词优先：命中经典台词库时直接播原声（还原度更高，且零延迟）。
 * 只有"整句就是那句经典台词"时才用原声 —— 否则长回复会被截断成一句台词。
 */
export async function synthesizeSpeech(
  text: string,
  ttsConfig: TTSConfig,
  emotion?: EmotionType
): Promise<PlayableAudio | null> {
  void emotion;
  log("[TTS] synthesizeSpeech 调用:", { enabled: ttsConfig.enabled, textLen: text.length });

  if (!ttsConfig.enabled) {
    console.warn("[TTS] 跳过：语音合成开关未打开（设置 → 语音合成）");
    return null;
  }

  const cleanText = cleanTTSText(stripParentheses(text));
  if (!cleanText) {
    console.warn("[TTS] 跳过：清洗后文本为空");
    return null;
  }

  const characterId = getSessionCharacterId();

  // === 口癖原声：整句就是那条原声时直接播（开场白 / 回答"口头禅是什么"）===
  // 注意：只做整句替换，不做"原声+合成"拼接 —— 拼接怎么调都不自然（2026-10-18 定案）
  const clip = matchCatchphrase(characterId, cleanText);
  if (clip) {
    log(`[TTS] 命中口癖原声: ${clip.id} (${clip.note})`);
    return { url: pickCatchphraseUrl(clip), format: "wav" };
  }

  // === 经典台词原声：仅当整句就是那条经典台词时才用，避免长回复被截断 ===
  if (characterId === "kurisu" && loadVoiceClipsEnabled()) {
    const voiceClip = matchVoiceClip(cleanText);
    if (voiceClip) {
      // 长度差太大说明回复是长句只是碰巧含关键词，交给合成
      const ratio = voiceClip.original.length / cleanText.length;
      if (ratio >= 0.7) {
        log(`[TTS] 命中经典台词原声: ${voiceClip.id} (${voiceClip.scene})`);
        return { url: voiceClipUrl(voiceClip.id), format: "wav" };
      }
    }
  }

  // === 云端合成（阿里云百炼 CosyVoice，粉丝自带 Key）===
  return synthesizeCloud(cleanText, characterId);
}

export function playAudio(audioData: PlayableAudio): Promise<void> {
  // === 分段流式：逐段无缝排队播放（2026-10-12 新增）===
  if (audioData.segments && audioData.segments.length > 0) {
    return playQueue(audioData.segments.map((b64) => ({ base64: b64, format: "wav" })));
  }

  return new Promise((resolve, reject) => {
    const audioEl: HTMLAudioElement = (() => {
      if (audioData.base64) {
        const fmt = audioData.format || "wav";
        return new Audio(`data:audio/${fmt};base64,${audioData.base64}`);
      }
      if (audioData.url) {
        return new Audio(audioData.url);
      }
      throw new Error("无可用音频数据");
    })();
    audioEl.volume = 1.0;
    const audio = audioEl;

    // === 用 Web Audio API 接管播放，实现真实音频振幅分析 ===
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    activeAudioEl = audio;

    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      const source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (err) {
      console.warn("[TTS] Web Audio API 初始化失败，降级普通播放:", err);
      analyser = null;
      if (audioCtx) { try { audioCtx.close(); } catch { /* 忽略 */ } audioCtx = null; }
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      // ⚠️ 必须先摘掉 handler 再清 src：给 src 赋值 "" 会异步触发 error 事件，
      // 而 onerror 里又会派发一次 tts-end —— 那个"迟到的 end"会把下一句的口型掐死。
      audio.onended = null;
      audio.onerror = null;
      if (activeAudioEl === audio) activeAudioEl = null;
      try { audio.pause(); } catch { /* 忽略 */ }
      try { audio.src = ""; } catch { /* 忽略 */ }
      try { audio.load(); } catch { /* 忽略 */ }
      if (audioCtx) {
        try { audioCtx.close(); } catch { /* 忽略 */ }
        audioCtx = null;
      }
    };

    // 本次播放会话号：start/end 都带它，Live2D 只认自己那次的 end
    const token = ++ttsSessionToken;

    // 派发事件通知 Live2D 开始说话，附带 analyser 供嘴唇同步使用
    window.dispatchEvent(new CustomEvent("amadeus-tts-start", { detail: { analyser, token } }));

    audio.onended = () => {
      window.dispatchEvent(new CustomEvent("amadeus-tts-end", { detail: { token } }));
      cleanup();
      resolve();
    };
    audio.onerror = (e) => {
      console.error("[TTS] 播放错误:", e);
      window.dispatchEvent(new CustomEvent("amadeus-tts-end", { detail: { token } }));
      cleanup();
      reject(e);
    };

    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => { /* 忽略 */ });
    }

    audio.play().catch((err) => {
      console.error("[TTS] play() 被拒绝:", err);
      window.dispatchEvent(new CustomEvent("amadeus-tts-end", { detail: { token } }));
      cleanup();
      reject(err);
    });
  });
}

/**
 * 依次播放多段音频，段与段之间无明显停顿。
 *
 * 每段独立解码播放，第一段一拿到就开始出声 —— 这就是"边想边说"的实现。
 * 也用于「口癖原声 + 合成音频」：原声排在第一段，后面紧跟合成，听感是连着的。
 * Live2D 口型：所有段共用一个 analyser（同时只有一段在播，信号不叠加），
 * tts-start 一直保持到最后一段播完才发 tts-end。
 */
function playQueue(sources: AudioSource[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const chain = { stopped: false, audio: null as HTMLAudioElement | null };
    activeSegmentChain = chain;

    // 预解码所有段，避免段间因解码造成卡顿
    const audios = sources.map((s) => {
      const fmt = s.format || "wav";
      const el = new Audio(s.url ? s.url : `data:audio/${fmt};base64,${s.base64}`);
      el.preload = "auto";
      el.volume = 1.0;
      return el;
    });

    if (audios.length === 0) {
      reject(new Error("无可用音频数据"));
      return;
    }

    // analyser 只挂在第一段上，供 Live2D 口型同步
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      const source = audioCtx.createMediaElementSource(audios[0]);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      // ⚠️ 所有段都要接 analyser！之前只挂第一段（"口型靠第一段带"），
      // 结果第 2 段开始嘴型失效（2026-10-17 用户实测"没对上口型"）。
      // 多个 source 接同一个 analyser 是允许的（同时只有一段在播，信号不叠加）。
      for (let i = 1; i < audios.length; i++) {
        try {
          const s = audioCtx.createMediaElementSource(audios[i]);
          s.connect(analyser);
        } catch {
          /* 忽略：某些环境每个元素只能建一次 source */
        }
      }
    } catch (err) {
      console.warn("[TTS] 分段播放 Web Audio 初始化失败，降级普通播放:", err);
      analyser = null;
      if (audioCtx) { try { audioCtx.close(); } catch { /* 忽略 */ } audioCtx = null; }
    }

    // 本次播放会话号（start/end 都带，Live2D 只认自己那次的 end）
    const token = ++ttsSessionToken;

    const finish = () => {
      window.dispatchEvent(new CustomEvent("amadeus-tts-end", { detail: { token } }));
      if (activeSegmentChain === chain) activeSegmentChain = null;
      for (const a of audios) {
        // ⚠️ 必须先摘 handler 再清 src（同上：清 src 会异步触发 error，
        // onerror 里 playNext() 越界后又 finish() 一次 → 多派发一个 end，
        // 那个迟到的 end 正好落在下一句的 tts-start 之后 → 下一句全程不张嘴）
        a.onended = null;
        a.onerror = null;
        try { a.pause(); } catch { /* 忽略 */ }
        try { a.src = ""; } catch { /* 忽略 */ }
      }
      if (audioCtx) {
        try { audioCtx.close(); } catch { /* 忽略 */ }
        audioCtx = null;
      }
    };

    window.dispatchEvent(new CustomEvent("amadeus-tts-start", { detail: { analyser, token } }));
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => { /* 忽略 */ });
    }

    let idx = 0;
    const playNext = () => {
      if (chain.stopped) return; // 被 stopCurrentAudio 打断
      if (idx >= audios.length) {
        finish();
        resolve();
        return;
      }
      const a = audios[idx];
      chain.audio = a;
      if (activeAudioEl === null || idx === 0) activeAudioEl = a;

      a.onended = () => {
        idx++;
        playNext();
      };
      a.onerror = (e) => {
        // 单段失败就跳过，不能因此卡住整条链
        console.warn(`[TTS] 第 ${idx + 1} 段播放失败，跳过:`, e);
        idx++;
        playNext();
      };
      a.play().catch((err) => {
        if (chain.stopped) return;
        console.warn(`[TTS] 第 ${idx + 1} 段 play() 被拒绝，跳过:`, err);
        idx++;
        playNext();
      });
    };

    playNext();
  });
}
