import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * 一键克隆红莉栖音色（Qwen3-TTS-VC 路径）
 *
 * 为什么用 Qwen 声音复刻而不是 CosyVoice：
 * - CosyVoice 声音复刻需要音频的公网 URL，本地桌面应用做不到（阿里云访问不到 localhost）
 * - Qwen 声音复刻支持 base64 直接上传音频，无需公网 URL，本地可用
 *
 * 流程：
 * 1. 读取内置 public/voice_sample.mp3（红莉栖音色样本，~360KB）
 * 2. 转 base64 data URL
 * 3. 调阿里云 qwen-voice-enrollment API（action=create）
 * 4. 返回 voice（音色名），前端存到 localStorage
 * 5. 之后 TTS 合成用 qwen3-tts-vc 引擎 + 这个 voice
 *
 * 注意：每个阿里云账号声音复刻数量有限（通常 20 个），
 * 重复克隆会创建多个音色。前端做了"已克隆则不重复"的判断。
 */
export async function POST(request: Request) {
  try {
    const { apiKey: rawApiKey } = (await request.json()) as { apiKey: string };
    const apiKey = (rawApiKey || "").trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "请先填写阿里云 API Key" },
        { status: 400 }
      );
    }

    // 1. 读取内置音色样本
    const samplePath = path.join(process.cwd(), "public", "voice_sample.mp3");
    if (!fs.existsSync(samplePath)) {
      return NextResponse.json(
        { error: "内置音色样本文件不存在（public/voice_sample.mp3）" },
        { status: 500 }
      );
    }
    const audioBuffer = fs.readFileSync(samplePath);
    const base64 = audioBuffer.toString("base64");
    const dataUrl = `data:audio/mpeg;base64,${base64}`;
    console.log(`[TTS clone] 音色样本已读取: ${(audioBuffer.length / 1024).toFixed(1)}KB, base64 长度: ${base64.length}`);

    // 2. 调阿里云 Qwen 声音复刻 API
    // 用 dashscope 默认域名（不需要 WorkspaceId 专属域名，通用）
    const cloneUrl = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";
    const t0 = Date.now();

    const res = await fetch(cloneUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen-voice-enrollment",
        input: {
          action: "create",
          target_model: "qwen3-tts-vc-realtime-2026-01-15",
          preferred_name: "amadeus_kurisu",
          audio: { data: dataUrl },
          language: "ja", // 红莉栖音色样本是日语
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[TTS clone] 阿里云错误:", res.status, errText);
      // 解析错误信息给用户更友好的提示
      let hint = "";
      if (res.status === 401) hint = "（API Key 无效或未开通百炼服务）";
      else if (res.status === 403) hint = "（可能未实名认证，或声音复刻服务未开通）";
      return NextResponse.json(
        { error: `阿里云返回 ${res.status}${hint}：${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    console.log(`[TTS clone] 克隆耗时: ${Date.now() - t0}ms, 返回:`, JSON.stringify(data).slice(0, 300));

    const voice = data?.output?.voice;
    if (!voice) {
      return NextResponse.json(
        { error: "克隆成功但未返回音色名，请重试" },
        { status: 500 }
      );
    }

    console.log(`[TTS clone] 克隆成功! voice=${voice}`);
    return NextResponse.json({
      voice,
      fallbackMode: data?.output?.fallback_mode || false,
      fallbackReason: data?.output?.fallback_reason || "",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "克隆请求失败";
    console.error("[TTS clone] 异常:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
