/**
 * 流式逐句 TTS 队列
 * =====================
 * 解决的问题：旧逻辑等 LLM 整条回复输出完才送 TTS，回复越长等待越久
 * （LLM 生成 10 秒 + 合成 5 秒 = 15 秒才出声）。
 *
 * 新逻辑：LLM 流式输出的**同时**逐句合成播放——
 *   1. LLM 吐中文（面板显示用），直到 `===` 分隔符
 *   2. `===` 之后的日语部分按句末标点切句，每句立即送合成
 *   3. 短句自动合并（< 10 字并进下一句，避免语气碎）
 *   4. 合成完的句子按入队顺序排队播放；播第 N 句时 N+1 已在后台合成
 *
 * 首响 = LLM 首句时间（1~3s）+ 首句合成（3~8s），回复越长收益越大。
 *
 * 兜底：LLM 偶尔不守双语格式（没有 ===）——流式期间若缓冲出现假名
 * 也开始切句；到 finish() 时若始终没进入日语区，整条按 parseMessage
 * 兜底逻辑处理（退化为旧行为，保证有声音）。
 */

import {
  synthesizeSpeechStream,
  playAudio,
  stripParentheses,
  cleanTTSText,
  type PlayableAudio,
  type TTSConfig,
} from "./tts";
import { getTTSText } from "./message-parser";
import { log } from "./debug-log";

/** 句末标点（省略号是两个 …，先匹配长模式） */
const SENTENCE_END = /\.{6}|…{2}|[。！？!?]/;
/**
 * 切段的最短长度（字）。
 * 2026-10-17 用户实测：碎段（10~25 字）被服务端二次切分后断断续续且更慢
 * （CosyVoice 短文本推理 RTF 飙到 5~29，还有"文本短于 prompt 性能劣化"官方警告）；
 * 大段（60 字 ≈ 2~4 句）一次推理 RTF 1.6~2.0，韵律连贯总耗时反而更短。
 */
const MIN_SEGMENT_CHARS = 60;

/** 句子清洗（与 tts.ts 的合成入口同一管线：剥括号动作 + 清洗标点） */
function cleanSentence(text: string): string {
  return cleanTTSText(stripParentheses(text));
}

export class StreamTTSQueue {
  /** 未成句缓冲 */
  private buffer = "";
  /** 是否已进入日语区（见到 === 分隔符 或 检测到假名兜底） */
  private inJapaneseZone = false;
  /** 合成中的句子（按入队顺序播放） */
  private queue: Array<Promise<PlayableAudio | null>> = [];
  /** 播放循环是否在跑 */
  private playing = false;
  /** LLM 流是否已结束（finish 已调用） */
  private finished = false;
  private cancelled = false;

  constructor(
    private ttsConfig: TTSConfig,
    private onAllDone: () => void,
  ) {}

  /**
   * LLM 流式输出的每个 delta 调一次。
   * 内部维护缓冲：=== 之前累积（中文区），之后按段落切送合成。
   */
  append(delta: string) {
    if (this.cancelled || this.finished) return;
    this.buffer += delta;

    if (!this.inJapaneseZone) {
      // 还在中文区：找 === 分隔符（容忍格式变体：前后不一定有换行）
      const m = this.buffer.match(/\n?==+\n?/);
      if (m && m.index !== undefined) {
        this.inJapaneseZone = true;
        this.buffer = this.buffer.substring(m.index + m[0].length);
        log(`[StreamTTS] 进入日语区，缓冲 ${this.buffer.length} 字`);
        this.flushSegments();
      }
      // ⚠️ 没有 hasJapanese 兜底——中文部分可能混着假名注音，宽松兜底会把
      // 中文一起送合成（2026-10-17 用户实测"奇怪的中文"复现的根因）。
      // 格式不守的回复退化为 finish() 时的整条处理（getTTSText 正确切日语）。
      return;
    }

    // 日语区：遇到再次出现的 ===（LLM 偶发多段输出）→ 丢弃之前的，防止中文混入
    const sep = this.buffer.match(/\n?==+\n?/);
    if (sep && sep.index !== undefined) {
      log(`[StreamTTS] 日语区再次出现 ===，重置缓冲（防中文混入）`);
      this.buffer = this.buffer.substring(sep.index + sep[0].length);
    }

    this.flushSegments();
  }

  /**
   * 扫描缓冲，凑够 MIN_SEGMENT_CHARS 的完整句才切一段送合成。
   *
   * ⚠️ 段不能太碎：CosyVoice3 每次合成调用是独立推理，太短的段韵律断裂
   * （2026-10-17 用户实测逐句播放"不如上一版"）。10 字级碎句是主因。
   * 现在攒到 25+ 字（1~3 句）才切，接近整段合成的听感，同时保住流式首响。
   */
  private flushSegments() {
    while (true) {
      const re = /\.{6}|…{2}|[。！？!?]/g;
      let m: RegExpExecArray | null;
      let lastEnd = -1;
      // 找最后一个"超过最小段长"的句末标点：尽可能切成大段
      while ((m = re.exec(this.buffer)) !== null) {
        const end = m.index + m[0].length;
        if (end >= MIN_SEGMENT_CHARS) {
          lastEnd = end;
        }
      }
      if (lastEnd === -1) break;

      const segment = this.buffer.slice(0, lastEnd);
      this.buffer = this.buffer.slice(lastEnd);
      this.enqueue(segment);
    }
  }

  /** 单句入队：清洗 → 空则丢 → 启动合成（并发，播放按序） */
  private enqueue(sentence: string) {
    const clean = cleanSentence(sentence);
    if (!clean) return;
    log(`[StreamTTS] 句子入队（${clean.length} 字）: ${clean.slice(0, 40)}`);
    const promise = synthesizeSpeechStream(clean, this.ttsConfig);
    this.queue.push(promise);
    this.kickPlayer();
  }

  /** 播放循环：按入队顺序等待合成结果并播放 */
  private kickPlayer() {
    if (this.playing) return;
    this.playing = true;
    void this.playLoop();
  }

  private async playLoop() {
    while (this.queue.length > 0) {
      const promise = this.queue.shift()!;
      try {
        const audio = await promise;
        if (this.cancelled) return;
        if (audio) {
          await playAudio(audio);
        }
      } catch (err) {
        console.error("[StreamTTS] 句子合成/播放失败:", err);
      }
    }
    this.playing = false;
    // 全部播完且流已结束 → 通知上层收尾
    if (this.finished && this.queue.length === 0) {
      this.onAllDone();
    }
  }

  /**
   * LLM 流结束时调用：冲刷剩余缓冲，标记结束。
   * 返回 drain promise？不——直接内部收尾，上层通过 onAllDone 感知完成。
   */
  finish() {
    if (this.cancelled || this.finished) return;
    this.finished = true;

    if (this.buffer.trim()) {
      if (this.inJapaneseZone) {
        // 日语区剩余：直接送合成（不再等 10 字门槛，最后一句可能短）
        const clean = cleanSentence(this.buffer);
        if (clean) {
          log(`[StreamTTS] 冲刷最后一句（${clean.length} 字）`);
          const promise = synthesizeSpeechStream(clean, this.ttsConfig);
          this.queue.push(promise);
        }
      } else {
        // 始终没进入日语区：整条走 parseMessage 兜底（旧行为）
        const ttsText = getTTSText(this.buffer);
        if (ttsText) {
          log(`[StreamTTS] 格式兜底：整条送合成（${ttsText.length} 字）`);
          const promise = synthesizeSpeechStream(ttsText, this.ttsConfig);
          this.queue.push(promise);
        }
      }
      this.buffer = "";
    }
    this.kickPlayer();
  }

  /** 出错时取消：停止后续播放（当前正在播的一声自然结束） */
  cancel() {
    this.cancelled = true;
    this.queue = [];
    this.finished = true;
  }

  /** 是否全部播完（供上层轮询，一般用 onAllDone 即可） */
  get isIdle(): boolean {
    return !this.playing && this.queue.length === 0;
  }
}
