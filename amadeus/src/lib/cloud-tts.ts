/**
 * 云端语音（阿里云百炼 CosyVoice）配置层（2026-10-19）
 * ====================================================
 * Key + 音色 ID 的本地存储。
 * 这里是纯常量与 localStorage 读写，**不能 import fs/path**（客户端组件会用）。
 *
 * 设计要点（照手机版已验证的做法）：
 *   - 粉丝自带 Key（各自的百炼账号），作者零成本、Key 不外泄
 *   - 首次选云端时用公网样本 URL 复刻音色，voice_id 绑定 cosyvoice-v3.5-flash
 *   - 音色复刻免费，只有合成按字符计费（0.8 元/万字符）
 *
 * 2026-10-25：本地语音模型功能整个删除，云端是唯一的合成引擎，
 * 原来的「本地 / 云端」二选一（amadeus_voice_engine）随之移除。
 */

/** 粉丝自己的阿里云百炼 API Key */
const ALIYUN_KEY_KEY = "amadeus_aliyun_api_key";
/** 已复刻音色：JSON { characterId: voiceId } */
const VOICES_KEY = "amadeus_cloud_voices";

/** 云端合成模型（音色绑定此模型，换模型必须重新复刻） */
export const CLOUD_MODEL = "cosyvoice-v3.5-flash";

/**
 * 三个角色的复刻样本（公网静态站，阿里云复刻要求公网可访问 URL）。
 * 改样本 = 换静态站文件，URL 不变。
 */
export const CLOUD_SAMPLE_URLS: Record<string, string> = {
  kurisu: "https://amadeus-voice-sample.app.workbuddy.host/voice_sample.mp3",
  maho: "https://amadeus-voice-sample.app.workbuddy.host/voice_sample_maho.wav",
  may: "https://amadeus-voice-sample.app.workbuddy.host/voice_sample_may.wav",
};

/** 复刻时的 prefix（阿里云限制 ≤10 字符） */
export const CLOUD_PREFIXES: Record<string, string> = {
  kurisu: "amdkuri",
  maho: "amdmaho",
  may: "amdemay",
};

export function loadAliyunKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ALIYUN_KEY_KEY) || "";
}

export function saveAliyunKey(key: string) {
  localStorage.setItem(ALIYUN_KEY_KEY, key.trim());
}

export function loadCloudVoices(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(VOICES_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCloudVoice(characterId: string, voiceId: string) {
  const m = loadCloudVoices();
  m[characterId] = voiceId;
  localStorage.setItem(VOICES_KEY, JSON.stringify(m));
}

export function clearCloudVoice(characterId: string) {
  const m = loadCloudVoices();
  delete m[characterId];
  localStorage.setItem(VOICES_KEY, JSON.stringify(m));
}
