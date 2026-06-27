import { NextResponse } from "next/server";

// === 阿里云百炼：红莉栖克隆音色 ID ===
const ALIYUN_VOICE_IDS: Record<string, string> = {
  "cosyvoice-v3.5-plus": "cosyvoice-v3.5-plus-kurisu-51ce632eac1c464589e3ea631f7e2254",
  "cosyvoice-v3.5-flash": "cosyvoice-v3.5-flash-kurisu-6d81ecf35c714af898327ffaa6199d22",
  "cosyvoice-v3-flash": "cosyvoice-v3-flash-kurisu-ced4e6c62b584da09f4042afae43c388",
  "cosyvoice-v3-plus": "cosyvoice-v3-plus-kurisu-7ad2af3f239d4b7ba323cb0731574bec",
  "qwen3-tts-vc": "qwen-tts-vc-kurisu-voice-20260620040542662-e6e4",
};

const ALIYUN_INSTRUCTION_SUPPORTED = new Set([
  "cosyvoice-v3.5-plus",
  "cosyvoice-v3.5-flash",
  "cosyvoice-v3-flash",
]);

const KURISU_INSTRUCTION =
  "用自然平和的语气说话，情绪跟随文本内容自然变化，不要刻意加强任何情绪，像真人日常对话一样。";

// === MiniMax：红莉栖克隆音色 ID ===
const MINIMAX_VOICE_ID = "kurisu-amadeus";

type TTSEngine = string;
type TTSProvider = "aliyun" | "minimax" | "custom";

interface TTSRequestBody {
  text: string;
  apiKey: string;
  engine?: TTSEngine;
  provider?: TTSProvider;
  voiceId?: string;
  custom?: { endpoint: string; model: string };
}

export async function POST(request: Request) {
  try {
    const {
      text,
      apiKey: rawApiKey,
      engine = "cosyvoice-v3.5-flash",
      provider = "aliyun",
      voiceId: userVoiceId,
      custom,
    } = (await request.json()) as TTSRequestBody;

    // 关键：trim 掉复制时可能带入的空格/换行符（401 的常见元凶）
    const apiKey = (rawApiKey || "").trim();

    // 服务端日志：打印收到的 Key 掩码，帮助诊断 401
    console.log(`[TTS route] provider=${provider}, engine=${engine}, apiKey 长度=${apiKey.length}, 掩码=***${apiKey.slice(-4)}, 前3位=${apiKey.slice(0, 3)}`);
    if (rawApiKey && rawApiKey.length !== apiKey.length) {
      console.warn(`[TTS route] 警告：收到的 apiKey 含前后空格/换行！原长度 ${rawApiKey.length}，trim 后 ${apiKey.length}`);
    }

    if (!text) {
      return NextResponse.json({ error: "文本不能为空" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: "请先在设置中配置 API Key" },
        { status: 400 }
      );
    }

    let audioBase64: string | undefined;

    if (provider === "minimax") {
      // === MiniMax T2A V2 ===
      // 优先用用户在设置里填的音色 ID，留空则用默认
      const voiceId = (userVoiceId || "").trim() || MINIMAX_VOICE_ID;
      const synthUrl = "https://api.minimaxi.com/v1/t2a_v2";

      const res = await fetch(synthUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: engine,
          text,
          stream: false,
          voice_setting: {
            voice_id: voiceId,
            speed: 1,
            vol: 1,
            pitch: 0,
          },
          audio_setting: {
            sample_rate: 32000,
            format: "wav",
            channel: 1,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[TTS] MiniMax 错误:", res.status, errText);
        return NextResponse.json(
          { error: `MiniMax 返回 ${res.status}：${errText.slice(0, 200)}` },
          { status: 502 }
        );
      }

      const data = await res.json();
      const audioHex: string | undefined = data?.data?.audio;

      if (!audioHex) {
        console.error("[TTS] MiniMax 无音频数据:", JSON.stringify(data).slice(0, 300));
        return NextResponse.json(
          { error: "MiniMax 语音合成失败" },
          { status: 500 }
        );
      }

      // MiniMax 返回 hex 编码音频，转 base64
      const audioBytes = Buffer.from(audioHex, "hex");
      audioBase64 = audioBytes.toString("base64");
      console.log(`[TTS] MiniMax 音频大小: ${audioBytes.length} bytes`);

    } else if (provider === "custom") {
      // === 自定义 TTS endpoint ===
      if (!custom?.endpoint || !custom?.model) {
        return NextResponse.json(
          { error: "自定义 TTS 需要配置 endpoint 和 model" },
          { status: 400 }
        );
      }

      const res = await fetch(`${custom.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: custom.model,
          messages: [
            { role: "user", content: text },
            { role: "assistant", content: "" },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[TTS] 自定义 错误:", res.status, errText);
        return NextResponse.json(
          { error: `自定义 TTS 返回 ${res.status}：${errText.slice(0, 200)}` },
          { status: 502 }
        );
      }

      const data = await res.json();
      const audio = data?.choices?.[0]?.message?.audio?.data;
      if (!audio) {
        return NextResponse.json(
          { error: "自定义 TTS 未返回音频" },
          { status: 500 }
        );
      }
      audioBase64 = audio;

    } else {
      // === 阿里云百炼 CosyVoice / Qwen-TTS ===
      // 优先用用户在设置里填的音色 ID（克隆自用户自己的阿里云账号）
      // 留空则用默认音色 ID（仅作者账号可用，其他账号调用会报错）
      const userVid = (userVoiceId || "").trim();
      const voiceId = userVid || ALIYUN_VOICE_IDS[engine];
      if (userVid) {
        console.log(`[TTS route] 使用用户自定义音色 ID: ${userVid.slice(0, 30)}...`);
      } else {
        console.log(`[TTS route] 使用默认音色 ID（仅作者账号可用）: ${voiceId?.slice(0, 30)}...`);
      }

      if (engine === "qwen3-tts-vc") {
        // Qwen3-TTS-VC (different endpoint)
        const synthUrl =
          "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
        const res = await fetch(synthUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "qwen3-tts-vc-2026-01-22",
            input: { text, voice: voiceId },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[TTS] Qwen3-TTS-VC 错误:", res.status, errText);
          return NextResponse.json(
            { error: `Qwen3-TTS-VC 返回 ${res.status}：${errText.slice(0, 200)}` },
            { status: 502 }
          );
        }

        const data = await res.json();
        const audioUrl = data?.output?.audio?.url;
        if (!audioUrl) {
          return NextResponse.json({ error: "Qwen3-TTS-VC 未返回音频" }, { status: 500 });
        }

        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) {
          return NextResponse.json({ error: "下载合成音频失败" }, { status: 502 });
        }
        const audioBuffer = await audioRes.arrayBuffer();
        audioBase64 = Buffer.from(audioBuffer).toString("base64");

      } else {
        // CosyVoice 系列
        // 格式用 mp3：wav 的 data chunk size 在流式合成里可能不规范，
        // 前端 <audio>/Web Audio API 解析时只读一段就认为结束（"读几个字就停"的元凶）。
        // mp3 是流式格式无此问题，且文件小 3-5 倍，下载快。
        const synthUrl =
          "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";

        const inputParams: Record<string, unknown> = {
          text,
          voice: voiceId,
          format: "mp3",
          sample_rate: 24000,
          language_hints: ["ja"],
          speech_rate: 1.0,
        };

        // 注：instruction 会让 TTS 引擎主动调节情绪，容易导致语气过重。
        // 改为不传 instruction，让引擎按文本本身自然朗读。
        // if (ALIYUN_INSTRUCTION_SUPPORTED.has(engine)) {
        //   inputParams.instruction = KURISU_INSTRUCTION;
        // }

        const synthT0 = Date.now();
        const res = await fetch(synthUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: engine, input: inputParams }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[TTS] CosyVoice 错误:", res.status, errText);
          return NextResponse.json(
            { error: `CosyVoice 返回 ${res.status}：${errText.slice(0, 200)}` },
            { status: 502 }
          );
        }

        const data = await res.json();
        console.log(`[TTS] CosyVoice 合成耗时: ${Date.now() - synthT0}ms, 返回结构 keys:`, Object.keys(data?.output?.audio || {}));

        // CosyVoice 可能返回单个 url 或 urls 数组（长文本分片）
        const audioObj = data?.output?.audio;
        const singleUrl: string | undefined = audioObj?.url;
        const urls: string[] | undefined = audioObj?.urls;

        if (!singleUrl && !urls?.length) {
          console.error("[TTS] CosyVoice 未返回音频 URL, 完整返回:", JSON.stringify(data).slice(0, 500));
          return NextResponse.json({ error: "CosyVoice 未返回音频" }, { status: 500 });
        }

        const urlsToFetch = urls?.length ? urls : [singleUrl!];

        // 关键优化：直接把 OSS URL 透传给前端，不在服务端下载。
        // 前端 <audio src={url}> 可以边下边播（mp3 流式），不用等服务端下载完整文件。
        // 省掉"服务端下载→base64编码→JSON→前端解码base64"整圈，实测能省 5-8 秒。
        // 单分片直接返回 url；多分片才在服务端下载合并（长文本才有多分片，少见）
        if (urlsToFetch.length === 1) {
          console.log(`[TTS] 单分片，直接返回 OSS URL 给前端流式播放: ${urlsToFetch[0].slice(0, 80)}...`);
          return NextResponse.json({ url: urlsToFetch[0], format: "mp3" });
        }

        // 多分片：服务端下载合并后返回 base64（长文本才走这分支）
        console.log(`[TTS] 多分片(${urlsToFetch.length})，服务端下载合并...`);
        const chunks: Buffer[] = [];
        for (let i = 0; i < urlsToFetch.length; i++) {
          const dlT0 = Date.now();
          const audioRes = await fetch(urlsToFetch[i]);
          if (!audioRes.ok) {
            console.error(`[TTS] 分片 ${i} 下载失败: ${audioRes.status}`);
            return NextResponse.json({ error: "下载合成音频失败" }, { status: 502 });
          }
          const buf = Buffer.from(await audioRes.arrayBuffer());
          chunks.push(buf);
          console.log(`[TTS] 分片 ${i} 下载: ${Date.now() - dlT0}ms, ${buf.length} bytes`);
        }

        const audioBuffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
        audioBase64 = audioBuffer.toString("base64");
        console.log(`[TTS] 音频总大小: ${audioBuffer.length} bytes (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
      }
    }

    if (!audioBase64) {
      return NextResponse.json({ error: "语音合成失败" }, { status: 500 });
    }

    return NextResponse.json({ audio: audioBase64 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "TTS 请求失败";
    console.error("[TTS] Request failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
