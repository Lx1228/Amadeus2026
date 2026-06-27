const TTS_STORAGE_KEY = "amadeus_tts_config";
const TTS_PROVIDER_STORAGE_KEY = "amadeus_tts_provider";
const ALIYUN_KEY_STORAGE_KEY = "amadeus_aliyun_api_key";
const MINIMAX_KEY_STORAGE_KEY = "amadeus_minimax_api_key";
const ALIYUN_VOICE_ID_STORAGE_KEY = "amadeus_aliyun_voice_id";
const MINIMAX_VOICE_ID_STORAGE_KEY = "amadeus_minimax_voice_id";
const TTS_ENGINE_STORAGE_KEY = "amadeus_tts_engine";
const TTS_ENGINE_MIGRATION_KEY = "amadeus_tts_engine_migrated_v2";
const CUSTOM_TTS_STORAGE_KEY = "amadeus_custom_tts";
const VOICE_SAMPLE_VERSION_KEY = "amadeus_voice_sample_version";
const VOICE_SAMPLE_VERSION = "v3";

// 默认引擎改为 flash（v3.5-flash）：合成速度比 plus 快约 50%+，音质差异日常对话几乎无感
// plus 是高质量慢速版，凌晨高峰期 TTS 延迟会被显著放大
const DEFAULT_TTS_ENGINE: AliyunEngine = "cosyvoice-v3.5-flash";

// === 提供商类型 ===
export type TTSProvider = "aliyun" | "minimax" | "custom";

// === 阿里云引擎 ===
export type AliyunEngine =
  | "cosyvoice-v3.5-plus"
  | "cosyvoice-v3.5-flash"
  | "cosyvoice-v3-flash"
  | "cosyvoice-v3-plus"
  | "qwen3-tts-vc";

// === MiniMax 引擎 ===
export type MiniMaxEngine =
  | "speech-2.8-hd"
  | "speech-2.8-turbo"
  | "speech-02-hd"
  | "speech-02-turbo";

export type TTSEngine = AliyunEngine | MiniMaxEngine;

// === 自定义 TTS 配置 ===
export interface CustomTTSConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface TTSConfig {
  enabled: boolean;
  voiceSample: string | null;
  autoPlay: boolean;
}

// === 存储函数 ===

export function loadTTSConfig(): TTSConfig {
  if (typeof window === "undefined") {
    return { enabled: false, voiceSample: null, autoPlay: true };
  }
  const saved = localStorage.getItem(TTS_STORAGE_KEY);
  const parsed = saved ? JSON.parse(saved) : { enabled: false, voiceSample: null };
  return { ...parsed, autoPlay: true };
}

export function saveTTSConfig(config: TTSConfig) {
  localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(config));
}

export function loadTTSProvider(): TTSProvider {
  if (typeof window === "undefined") return "aliyun";
  return (localStorage.getItem(TTS_PROVIDER_STORAGE_KEY) as TTSProvider) || "aliyun";
}

export function saveTTSProvider(provider: TTSProvider) {
  localStorage.setItem(TTS_PROVIDER_STORAGE_KEY, provider);
}

export function loadAliyunAPIKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ALIYUN_KEY_STORAGE_KEY) || "";
}

export function saveAliyunAPIKey(key: string) {
  localStorage.setItem(ALIYUN_KEY_STORAGE_KEY, key);
}

export function loadMiniMaxAPIKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(MINIMAX_KEY_STORAGE_KEY) || "";
}

export function saveMiniMaxAPIKey(key: string) {
  localStorage.setItem(MINIMAX_KEY_STORAGE_KEY, key);
}

// === 音色 ID（用户自行克隆的音色 ID，留空则服务端用默认） ===
export function loadAliyunVoiceId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ALIYUN_VOICE_ID_STORAGE_KEY) || "";
}

export function saveAliyunVoiceId(id: string) {
  localStorage.setItem(ALIYUN_VOICE_ID_STORAGE_KEY, id);
}

export function loadMiniMaxVoiceId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(MINIMAX_VOICE_ID_STORAGE_KEY) || "";
}

export function saveMiniMaxVoiceId(id: string) {
  localStorage.setItem(MINIMAX_VOICE_ID_STORAGE_KEY, id);
}

export function loadTTSEngine(): TTSEngine {
  if (typeof window === "undefined") return DEFAULT_TTS_ENGINE;
  // 一次性迁移：把旧的 plus 默认值升级到 flash（用户后来手动改的不动）
  // 用 migrated 标记保证幂等，只在首次访问时执行一次
  const migrated = localStorage.getItem(TTS_ENGINE_MIGRATION_KEY);
  const saved = localStorage.getItem(TTS_ENGINE_STORAGE_KEY) as TTSEngine | null;
  if (!migrated) {
    // 未设过、或仍是 plus（旧默认值）→ 切到 flash
    if (!saved || saved === "cosyvoice-v3.5-plus") {
      localStorage.setItem(TTS_ENGINE_STORAGE_KEY, DEFAULT_TTS_ENGINE);
      localStorage.setItem(TTS_ENGINE_MIGRATION_KEY, "1");
      return DEFAULT_TTS_ENGINE;
    }
    // 用户已手动选了其他引擎（flash/v3-flash/qwen3-tts-vc 等），保留用户选择
    localStorage.setItem(TTS_ENGINE_MIGRATION_KEY, "1");
    return saved;
  }
  return saved || DEFAULT_TTS_ENGINE;
}

export function saveTTSEngine(engine: TTSEngine) {
  localStorage.setItem(TTS_ENGINE_STORAGE_KEY, engine);
}

export function loadCustomTTS(): CustomTTSConfig {
  if (typeof window === "undefined") return { endpoint: "", model: "", apiKey: "" };
  const saved = localStorage.getItem(CUSTOM_TTS_STORAGE_KEY);
  return saved ? JSON.parse(saved) : { endpoint: "", model: "", apiKey: "" };
}

export function saveCustomTTS(config: CustomTTSConfig) {
  localStorage.setItem(CUSTOM_TTS_STORAGE_KEY, JSON.stringify(config));
}

// === 音色样本（兼容旧逻辑） ===

export async function loadDefaultVoiceSample(): Promise<string | null> {
  try {
    const res = await fetch("/voice_sample.mp3");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function ensureVoiceSample(config: TTSConfig): Promise<TTSConfig> {
  const savedVersion = typeof window !== "undefined"
    ? localStorage.getItem(VOICE_SAMPLE_VERSION_KEY)
    : null;
  const needsRefresh = savedVersion !== VOICE_SAMPLE_VERSION;
  if (config.voiceSample && !needsRefresh) return config;
  const defaultSample = await loadDefaultVoiceSample();
  if (!defaultSample) return config;
  const updated = { ...config, voiceSample: defaultSample };
  saveTTSConfig(updated);
  if (typeof window !== "undefined") {
    localStorage.setItem(VOICE_SAMPLE_VERSION_KEY, VOICE_SAMPLE_VERSION);
  }
  return updated;
}

// === 合成 ===

/**
 * 可播放的音频。
 * - url：直接 URL（优先，浏览器流式边下边播，省 base64 编解码）
 * - base64：base64 数据（降级，多分片合并或自定义 provider 时用）
 */
export interface PlayableAudio {
  url?: string;
  base64?: string;
  format?: string;
}

function stripParentheses(text: string): string {
  return text.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 清理 TTS 文本，修复 CosyVoice 末尾拖音问题。
 * 问题根因：
 * 1. 末尾省略号 `...` 或 `。。。` 会被引擎读成 "yi" 等奇怪音
 * 2. 末尾日语助词（わ/よ/ね）被拖长成 "wa~"、"yo~"（二三声调）
 * 3. 多余换行符被当内容朗读
 * 4. 末尾无标点时引擎不知道句子结束，会自动补拖音
 */
function cleanTTS_text(text: string): string {
  let t = text;
  // 1. 去掉省略号（中英文、连续句点）
  t = t.replace(/\.{3,}/g, "。");
  t = t.replace(/…/g, "。");
  t = t.replace(/。{2,}/g, "。");
  // 2. 去掉波浪号（会被读成颤音）
  t = t.replace(/~/g, "");
  t = t.replace(/〜/g, "");
  // 3. 合并多余换行/空格
  t = t.replace(/\s+/g, " ").trim();
  // 4. 末尾确保有句号（让引擎明确句子结束，避免自动补拖音）
  //    但已有标点（。！？!?）就不加
  if (t && !/[。！？!?\.]$/.test(t)) {
    t = t + "。";
  }
  return t;
}

export async function synthesizeSpeech(
  text: string,
  ttsConfig: TTSConfig
): Promise<PlayableAudio | null> {
  console.log("[TTS] synthesizeSpeech 调用:", { enabled: ttsConfig.enabled, textLen: text.length, textPreview: text.slice(0, 40) });

  if (!ttsConfig.enabled) {
    console.warn("[TTS] 跳过：ttsConfig.enabled = false（请到设置→语音合成里打开开关）");
    return null;
  }

  const cleanText = cleanTTS_text(stripParentheses(text));
  if (!cleanText) {
    console.warn("[TTS] 跳过：清洗后文本为空");
    return null;
  }
  console.log("[TTS] 清洗后文本:", cleanText.slice(0, 80), "（长度:", cleanText.length, "）");

  const provider = loadTTSProvider();
  const engine = loadTTSEngine();
  console.log("[TTS] 当前配置:", { provider, engine });

  // 根据提供商获取对应的 API Key 和音色 ID
  let apiKey: string;
  let voiceId: string;
  if (provider === "aliyun") {
    apiKey = loadAliyunAPIKey();
    voiceId = loadAliyunVoiceId();
  } else if (provider === "minimax") {
    apiKey = loadMiniMaxAPIKey();
    voiceId = loadMiniMaxVoiceId();
  } else {
    apiKey = loadCustomTTS().apiKey;
    voiceId = "";
  }
  // 关键：trim 掉复制时可能带入的空格/换行符（401 的常见元凶）
  apiKey = (apiKey || "").trim();
  if (!apiKey) {
    console.error(`[TTS] 失败：未配置 ${provider} API Key（请到设置→语音合成里填写）`);
    return null;
  }
  console.log(`[TTS] API Key 掩码：***${apiKey.slice(-4)}（共 ${apiKey.length} 字符，前3位: ${apiKey.slice(0, 3)}）`);

  try {
    const t0 = Date.now();
    console.log("[TTS] 请求 /api/tts:", { provider, engine, textLen: cleanText.length });
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: cleanText,
        apiKey,
        engine,
        provider,
        voiceId,
        ...(provider === "custom" ? { custom: loadCustomTTS() } : {}),
      }),
    });

    const data = await res.json();
    console.log(`[TTS] 响应耗时: ${Date.now() - t0}ms`);
    if (data.error) {
      console.error("[TTS] 服务端错误:", data.error);
      return null;
    }
    // 优先 URL（服务端透传 OSS URL，前端流式播放）
    if (data.url) {
      console.log("[TTS] 合成成功，返回 URL:", data.url.slice(0, 80), "...");
      return { url: data.url, format: data.format || "mp3" };
    }
    if (!data.audio) {
      console.error("[TTS] 返回数据中无 audio/url 字段:", data);
      return null;
    }
    console.log("[TTS] 合成成功，audio base64 长度:", data.audio.length);
    return { base64: data.audio, format: data.format || "mp3" };
  } catch (error) {
    console.error("[TTS] 请求异常:", error);
    return null;
  }
}

export function playAudio(audioData: PlayableAudio): Promise<void> {
  return new Promise((resolve, reject) => {
    // 优先 URL（流式播放，边下边播，省 base64 编解码）
    // 降级 base64
    const audioEl: HTMLAudioElement = (() => {
      if (audioData.url) {
        console.log("[TTS] playAudio 用 URL 直接播放:", audioData.url.slice(0, 80));
        const el = new Audio(audioData.url);
        // 设 crossOrigin：OSS 若开了 CORS，analyser 能读到振幅做嘴唇同步；
        // 若没开，analyser 读到 0（静音数据），但音频不受影响。
        el.crossOrigin = "anonymous";
        return el;
      }
      if (audioData.base64) {
        console.log("[TTS] playAudio 用 base64 播放，长度:", audioData.base64.length);
        const fmt = audioData.format || "mp3";
        return new Audio(`data:audio/${fmt};base64,${audioData.base64}`);
      }
      throw new Error("无可用音频数据");
    })();
    audioEl.volume = 1.0;
    const audio = audioEl;

    // === 用 Web Audio API 接管播放，实现真实音频振幅分析 ===
    // CORS taint 不会抛异常，只是 analyser 返回 0 数据；音频播放正常。
    // createMediaElementSource 真正抛异常的情况（极少）才降级为纯 audio 元素播放。
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      const source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      console.log("[TTS] Web Audio API 接管播放，analyser 已就绪");
    } catch (err) {
      console.warn("[TTS] Web Audio API 初始化失败，降级普通播放:", err);
      analyser = null;
      if (audioCtx) { try { audioCtx.close(); } catch { /* 忽略 */ } audioCtx = null; }
    }

    // 统一清理函数：释放音频元素 + 关闭 AudioContext
    // 关键：createMediaElementSource 会让 audioCtx 强引用 audio，
    // 不 close audioCtx 则 audio 永远不会被 GC → 长时间使用内存确实会涨。
    // audio.src="" + load() 让浏览器丢弃已下载/解码的媒体数据。
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { audio.pause(); } catch { /* 忽略 */ }
      try { audio.src = ""; } catch { /* 忽略 */ }
      try { audio.load(); } catch { /* 忽略 */ }
      if (audioCtx) {
        try { audioCtx.close(); } catch { /* 忽略 */ }
        audioCtx = null;
      }
    };

    // 派发事件通知 Live2D 开始说话，附带 analyser 供嘴唇同步使用
    window.dispatchEvent(new CustomEvent("amadeus-tts-start", { detail: { analyser } }));

    // 元数据加载后打印时长，诊断"读几个字就停"
    audio.onloadedmetadata = () => {
      console.log(`[TTS] 音频元数据: duration=${audio.duration}s, readyState=${audio.readyState}`);
    };

    audio.onended = () => {
      console.log(`[TTS] 播放结束, 实际播放到=${audio.currentTime}s / 总长=${audio.duration}s`);
      window.dispatchEvent(new CustomEvent("amadeus-tts-end"));
      cleanup();
      resolve();
    };
    audio.onerror = (e) => {
      console.error("[TTS] 播放错误:", e, "errorCode:", audio.error?.code, "errorMsg:", audio.error?.message);
      window.dispatchEvent(new CustomEvent("amadeus-tts-end"));
      cleanup();
      reject(e);
    };

    // 浏览器自动播放策略：需要先 resume AudioContext
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => { /* 忽略 */ });
    }

    audio.play().then(() => {
      console.log("[TTS] play() 已开始");
    }).catch((err) => {
      console.error("[TTS] play() 被拒绝:", err);
      window.dispatchEvent(new CustomEvent("amadeus-tts-end"));
      cleanup();
      reject(err);
    });
  });
}
