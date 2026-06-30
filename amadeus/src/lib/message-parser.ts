/**
 * 消息解析工具：从 LLM 的回复中提取情绪标签、中文、日语。
 *
 * LLM 按人设要求输出格式：
 *   [emotion:xxx]（动作）中文内容
 *   ===
 *   （动作）日本語内容
 *
 * - 情绪标签用于驱动 Live2D 表情
 * - 面板显示用中文部分（用户看得懂）
 * - TTS 合成用日语部分（红莉栖说日语，像动漫一样）
 * - 兜底：若格式不匹配（旧消息/LLM 偶尔不遵守），原样返回
 */

import type { EmotionType } from "./emotion";

const EMOTION_REGEX = /^\[emotion:(neutral|blush|angry|smile|sad)\]/;

export interface ParsedContent {
  /** 中文内容（面板显示用，已去除情绪标签） */
  zh: string;
  /** 日语内容（TTS 合成用） */
  ja: string;
  /** 是否成功解析出双语言格式 */
  isBilingual: boolean;
  /** 情绪标签（解析失败时为 null） */
  emotion: EmotionType | null;
}

export function parseMessage(raw: string): ParsedContent {
  // 1. 先提取情绪标签
  let emotion: EmotionType | null = null;
  let textWithoutEmotion = raw;
  const emotionMatch = raw.match(EMOTION_REGEX);
  if (emotionMatch) {
    emotion = emotionMatch[1] as EmotionType;
    textWithoutEmotion = raw.substring(emotionMatch[0].length);
  }

  // 2. 匹配 === 分隔符格式（中文\n===\n日语）
  const separatorIndex = textWithoutEmotion.indexOf("\n===\n");
  if (separatorIndex !== -1) {
    const zh = textWithoutEmotion.substring(0, separatorIndex).trim();
    const ja = textWithoutEmotion.substring(separatorIndex + 5).trim();
    if (zh && ja) {
      return { zh, ja, isBilingual: true, emotion };
    }
  }

  // 3. 兜底兼容旧的 [zh]...[/zh][ja]...[/ja] 格式
  const zhMatch = textWithoutEmotion.match(/\[zh\]([\s\S]*?)\[\/zh\]/i);
  const jaMatch = textWithoutEmotion.match(/\[ja\]([\s\S]*?)\[\/ja\]/i);
  if (zhMatch && jaMatch) {
    return {
      zh: zhMatch[1].trim(),
      ja: jaMatch[1].trim(),
      isBilingual: true,
      emotion,
    };
  }

  // 4. 格式不匹配时，中文和日语都用原文（兜底）
  return {
    zh: textWithoutEmotion.trim(),
    ja: textWithoutEmotion.trim(),
    isBilingual: false,
    emotion,
  };
}

/**
 * 检测文本是否包含日语字符（平假名或片假名）。
 */
function hasJapanese(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

/**
 * 从消息内容中提取用于 TTS 合成的文本。
 * 优先用日语版本；若解析失败且文本不含日语字符，返回空（跳过 TTS）。
 */
export function getTTSText(raw: string): string {
  const parsed = parseMessage(raw);

  // 双语解析成功，直接用日语部分
  if (parsed.isBilingual && parsed.ja) {
    return parsed.ja;
  }

  // 解析失败（兜底），检查是否含日语假名
  if (hasJapanese(parsed.ja)) {
    return parsed.ja;
  }

  // 纯中文且无双语格式，跳过 TTS
  console.warn(
    "[TTS] 跳过：LLM 未按人设输出双语格式，文本无日语部分。raw 预览:",
    raw.slice(0, 80)
  );
  return "";
}
