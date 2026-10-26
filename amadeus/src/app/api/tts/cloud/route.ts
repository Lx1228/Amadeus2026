import { NextResponse } from "next/server";
import { CLOUD_MODEL } from "@/lib/cloud-tts";

export const dynamic = "force-dynamic";

/**
 * 云端合成（阿里云百炼 CosyVoice，2026-10-19）
 * -----------------------------------------
 * POST /api/tts/cloud   { text, voiceId, apiKey }
 * → { audio: base64 mp3, format: "mp3" } | { error, code }
 *
 * 官方接口是"给一个 OSS 临时下载链接"，这里服务端直接把 mp3 拉回来转 base64，
 * 前端拿到就能播 —— 免得 OSS 链接过期、也避免浏览器跨域。
 *
 * 错误里带上 code，前端据此判断"音色失效"（需要重新复刻）。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    const apiKey = String(body.apiKey || "").trim();
    const voiceId = String(body.voiceId || "").trim();

    if (!text) return NextResponse.json({ error: "文本为空" }, { status: 400 });
    if (!apiKey) {
      return NextResponse.json({ error: "请先在设置里填写阿里云 API Key" }, { status: 400 });
    }
    if (!voiceId) {
      return NextResponse.json({ error: "音色未就绪（请先复刻音色）", code: "NO_VOICE" }, { status: 400 });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(
        "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: CLOUD_MODEL,
            input: {
              text,
              voice: voiceId,
              format: "mp3",
              sample_rate: 24000,
              language_hints: ["ja"],
              rate: 1.0,
            },
          }),
          signal: ctrl.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      const msg =
        data?.message || data?.error?.message || `合成失败（HTTP ${res.status}）`;
      const code = data?.code || data?.error?.code || `HTTP_${res.status}`;
      console.error(`[云端语音] 合成失败: ${msg} (${code})`);
      return NextResponse.json({ error: msg, code }, { status: 400 });
    }

    const audioObj = data?.output?.audio;
    const url: string | undefined = audioObj?.url || audioObj?.urls?.[0];
    if (!url) {
      console.error("[云端语音] 合成响应里没有音频链接:", JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ error: "云端未返回音频" }, { status: 502 });
    }

    // 下载 mp3 → base64（OSS 链接有效期内必须取回）
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: `音频下载失败（HTTP ${audioRes.status}）` },
        { status: 502 }
      );
    }
    const buf = Buffer.from(await audioRes.arrayBuffer());
    const chars = Number(data?.usage?.characters) || 0;
    console.log(`[云端语音] 合成完成 ${chars} 字 → ${(buf.length / 1024).toFixed(0)}KB`);

    return NextResponse.json({
      audio: buf.toString("base64"),
      format: "mp3",
      characters: chars,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[云端语音] 合成异常:", msg);
    return NextResponse.json({ error: `合成请求异常: ${msg}` }, { status: 500 });
  }
}
