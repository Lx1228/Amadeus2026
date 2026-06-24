/**
 * 情绪分析：从 LLM 回复中提取情绪标签，驱动 Live2D 表情。
 *
 * v2：优先从 LLM 回复的 [emotion:xxx] 标签提取（语义级准确），
 *     回退到关键词匹配（兜底）。
 */

export type EmotionType = "angry" | "blush" | "smile" | "sad" | "neutral" | "surprised" | "shy";

export interface EmotionResult {
  emotion: EmotionType;
  intensity: number;
  duration: number;
}

// === 关键词表（兜底用） ===
const BLUSH_KEYWORDS = [
  "害羞", "脸红", "发红", "红了", "微微红", "脸微微", "脸颊", "发热",
  "（小声）", "（轻声）", "（低头）", "（别过脸", "（移开视线", "（不敢看",
  "喜欢你", "想我", "想你", "心动", "怦怦", "不知所措", "不知道该怎么",
  "才不是", "才没有",
  "恥ずか", "好き", "ドキドキ", "赤面", "顔が熱", "頬が",
];

const ANGRY_KEYWORDS = [
  "生气", "怒", "烦", "讨厌", "滚", "闭嘴", "够了", "无语", "真是的",
  "（皱眉", "（瞪", "（扶额", "（叹气", "切", "哼", "不可理喻",
  "笨蛋", "变态", "白痴", "脑残",
  "ムカ", "うるさい", "黙れ", "呆れ", "バカ", "変態",
];

const SMILE_KEYWORDS = [
  "笑", "（轻笑", "（微笑", "（一笑", "开心", "高兴", "哼哼", "不错",
  "好吧好吧", "真拿你没办法", "（点头", "得意", "满意", "温柔",
  "（抿嘴", "嘴角", "（浅笑", "（笑了笑",
  "にっこり", "ふふ", "嬉しい", "まあいい", "くすっ",
];

const SAD_KEYWORDS = [
  "难过", "失落", "感伤", "沉默", "叹气", "寂寞", "孤独", "想念",
  "（沉默", "（低头", "（黯然",
  "悲しい", "寂しい", "ため息",
];

const SURPRISED_KEYWORDS = [
  "惊讶", "震惊", "吃惊", "意外", "没想到", "居然", "竟然", "什么？",
  "（惊", "（瞪大", "（愣", "诶？", "诶！", "啊？", "哈？",
  "びっくり", "まさか", "えっ", "え！",
];

const SHY_KEYWORDS = [
  "害羞", "不好意思", "难为情", "扭捏", "小声", "嗫嚅",
  "（扭过头", "（蜷缩", "（捂脸", "（双手捂", "别看我",
  "恥ずかしい", "照れ", "もじもじ",
];

function matchKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/**
 * 从 LLM 回复中提取情绪。
 * 优先用 [emotion:xxx] 标签（v2），回退到关键词匹配（v1）。
 */
export function analyzeEmotion(raw: string): EmotionResult {
  // 1. 优先从 [emotion:xxx] 标签提取
  const emotionMatch = raw.match(/^\[emotion:(neutral|blush|angry|smile|sad|surprised|shy)\]/);
  if (emotionMatch) {
    const emotion = emotionMatch[1] as EmotionType;
    const durationMap: Record<EmotionType, number> = {
      blush: 5000,
      angry: 4000,
      smile: 4000,
      sad: 5000,
      surprised: 3000,
      shy: 5000,
      neutral: 0,
    };
    const intensityMap: Record<EmotionType, number> = {
      blush: 0.85,
      angry: 0.8,
      smile: 0.7,
      sad: 0.6,
      surprised: 0.9,
      shy: 0.75,
      neutral: 0,
    };
    return {
      emotion,
      intensity: intensityMap[emotion],
      duration: durationMap[emotion],
    };
  }

  // 2. 回退：关键词匹配
  if (matchKeywords(raw, BLUSH_KEYWORDS)) {
    return { emotion: "blush", intensity: 0.8, duration: 5000 };
  }
  if (matchKeywords(raw, ANGRY_KEYWORDS)) {
    return { emotion: "angry", intensity: 0.8, duration: 4000 };
  }
  if (matchKeywords(raw, SAD_KEYWORDS)) {
    return { emotion: "sad", intensity: 0.6, duration: 5000 };
  }
  if (matchKeywords(raw, SMILE_KEYWORDS)) {
    return { emotion: "smile", intensity: 0.6, duration: 4000 };
  }
  if (matchKeywords(raw, SURPRISED_KEYWORDS)) {
    return { emotion: "surprised", intensity: 0.8, duration: 3000 };
  }
  if (matchKeywords(raw, SHY_KEYWORDS)) {
    return { emotion: "shy", intensity: 0.7, duration: 5000 };
  }

  return { emotion: "neutral", intensity: 0, duration: 0 };
}

/**
 * 派发情绪事件给 Live2D。
 */
export function dispatchEmotion(raw: string) {
  const result = analyzeEmotion(raw);
  if (result.emotion === "neutral") return;

  window.dispatchEvent(new CustomEvent("amadeus-emotion", {
    detail: {
      emotion: result.emotion,
      intensity: result.intensity,
      duration: result.duration,
    },
  }));

  console.log("[Emotion] 派发:", result);
}
