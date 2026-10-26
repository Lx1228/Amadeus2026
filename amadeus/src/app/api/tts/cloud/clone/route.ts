import { NextResponse } from "next/server";
import {
  CLOUD_MODEL,
  CLOUD_PREFIXES,
  CLOUD_SAMPLE_URLS,
} from "@/lib/cloud-tts";

export const dynamic = "force-dynamic";

/**
 * 云端音色复刻（阿里云百炼 voice-enrollment / create_voice，2026-10-19）
 * ----------------------------------------------------------------
 * POST /api/tts/cloud/clone   { characterId, apiKey }
 * → { voiceId } | { error }
 *
 * 放在服务端做的原因：浏览器直连 DashScope 会被 CORS 拦（手机版靠 Capacitor 原生 HTTP
 * 才绕过），桌面版有本地 Next 服务，直接转发最干净。
 *
 * 复刻本身免费，只有合成按字符计费。
 * ⚠️ 注意事项（实测踩过）：
 *   - prefix 不能超过 10 个字符
 *   - voice_id 绑定 target_model，不能跨模型使用
 *   - 参考音频必须是公网可访问 URL
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const characterId = String(body.characterId || "").trim().toLowerCase();
    const apiKey = String(body.apiKey || "").trim();

    if (!apiKey) {
      return NextResponse.json({ error: "请先在设置里填写阿里云 API Key" }, { status: 400 });
    }
    const sampleUrl = CLOUD_SAMPLE_URLS[characterId];
    if (!sampleUrl) {
      return NextResponse.json({ error: `未知角色: ${characterId}` }, { status: 400 });
    }
    const prefix = CLOUD_PREFIXES[characterId] || "amadeus";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(
        "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "voice-enrollment",
            input: {
              action: "create_voice",
              target_model: CLOUD_MODEL,
              prefix,
              url: sampleUrl,
              language_hints: ["ja"],
            },
          }),
          signal: ctrl.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    const voiceId = data?.output?.voice_id || data?.output?.voice;
    if (!res.ok || !voiceId) {
      const msg =
        data?.message || data?.error?.message || `复刻失败（HTTP ${res.status}）`;
      console.error(`[云端语音] 复刻失败(${characterId}): ${msg}`);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    console.log(`[云端语音] 复刻成功 ${characterId} → ${voiceId}`);
    return NextResponse.json({ voiceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[云端语音] 复刻异常:", msg);
    return NextResponse.json({ error: `复刻请求异常: ${msg}` }, { status: 500 });
  }
}
