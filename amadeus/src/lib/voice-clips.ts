/**
 * 经典台词原声库
 * ================
 * 红莉栖的经典短句直接播放影视原声，还原度 100%（优于克隆合成）。
 * 音频来自 Hugging Face 数据集 starrydark/Kurisu_Voice（声优：今井麻美），
 * 全部为宽带人声（bandwidth ≥ 8000Hz）、质量 A 级、1-4 秒的独立短句。
 *
 * 匹配策略（两级）：
 *   1. 整句完全匹配 —— 回复的日文与original 完全一致 → 播原声
 *   2. 关键词触发   —— 回复含 keywords 里的词 → 播原声
 *
 * 找不到对应原声时，调用方应回退到 IndexTTS 合成。
 */

/** 单条经典台词 */
export interface VoiceClip {
  /** 唯一标识，同时是 public/clips/ 下的文件名 */
  id: string;
  /** 场景标签（仅用于调试展示） */
  scene: string;
  /** 原声日文原文，用于整句完全匹配 */
  original: string;
  /** 触发关键词，任一命中即触发 */
  keywords: string[];
  /** 中文说明，仅用于调试展示 */
  note: string;
}

/**
 * 经典台词库
 *
 * 说明：这些台词都是「脱离上下文也能听懂」的短句，
 * 所以关键词匹配不会显得突兀。
 * 语速/情绪由原声本身决定，不受合成端的情绪向量影响。
 *
 * 实现注意：用函数而不是顶层 const。
 * Turbopack 打包 Settings/TTS 时会把多个模块合并进同一 chunk，
 * 顶层 const 可能被排到引用点之后，触发
 * "ReferenceError: Cannot access 'X' before initialization"（TDZ），
 * 导致整页加载失败。改成函数可确保调用时才求值。
 */
export function getVoiceClips(): VoiceClip[] {
  return [
    {
      id: "isee",
      scene: "恍然明白",
      original: "いや、あ、そうか……",
      keywords: ["そうか"],
      note: "啊，原来如此……",
    },
    {
      id: "nope",
      scene: "否定",
      original: "あ、ううん、なんでもない……",
      keywords: ["ううん"],
      note: "不、没什么……",
    },
    {
      id: "surprise",
      scene: "惊讶",
      original: "え？ちょっと、桐生さん！？",
      keywords: ["え？"],
      note: "咦？",
    },
    {
      id: "angry",
      scene: "生气怒斥",
      original: "うるさいな……",
      keywords: ["うるさい"],
      note: "吵死了……",
    },
    {
      id: "sigh",
      scene: "无奈",
      original: "まさか……冗談でしょう？",
      keywords: ["まさか"],
      note: "不会吧……你在开玩笑吧？",
    },
  ];
}

/** 台词库总开关的 localStorage key（2026-10-12 起固定开启，仅保留 key 兼容旧数据） */
const CLIPS_ENABLED_KEY = "amadeus_voice_clips_enabled";

/**
 * 是否启用经典台词原声。
 *
 * 2026-10-12 用户决定：经典台词原声默认开启，设置页不再暴露开关，
 * 所以这里恒为 true，并清理掉历史上可能存下的 "0"（旧版本用户手动关过）。
 * 保留 saveVoiceClipsEnabled 只是兼容旧代码签名，实际不再改变状态。
 */
export function loadVoiceClipsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    localStorage.removeItem(CLIPS_ENABLED_KEY);
  } catch {
    /* 忽略隐私模式下的写入异常 */
  }
  return true;
}

export function saveVoiceClipsEnabled(_enabled: boolean) {
  // 固定开启，不再持久化
  void _enabled;
}

/** 文本归一化：去掉标点、空白，统一全角/半角问号 */
function normalize(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s。、！？!?「」『』…,.~～ー]/g, "");
}

/**
 * 在经典台词库里查找匹配项。
 *
 * @param text 日语文本（应已清洗过标点）
 * @returns 命中的台词；没命中返回 null
 */
export function matchVoiceClip(text: string): VoiceClip | null {
  if (!text) return null;

  const norm = normalize(text);
  if (!norm) return null;

  const clips = getVoiceClips();

  // 1) 整句完全匹配（优先级最高）
  for (const clip of clips) {
    if (normalize(clip.original) === norm) return clip;
  }

  // 2) 关键词触发。
  //    关键词归一化后做包含判断，避免 "え？" 的全角/半角差异。
  for (const clip of clips) {
    for (const kw of clip.keywords) {
      const nkw = normalize(kw);
      if (nkw && norm.includes(nkw)) return clip;
    }
  }

  return null;
}

/** 台词原声的公开访问路径 */
export function voiceClipUrl(id: string): string {
  return `/clips/${id}.wav`;
}