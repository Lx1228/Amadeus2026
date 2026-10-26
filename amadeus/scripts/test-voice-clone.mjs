/**
 * 声音复刻接口实测脚本（2026-10-11 阿里云下线事件后）
 *
 * 背景：qwen-voice-enrollment 已于 2026-10-10 下线，新模型 voice-enrollment
 *       参数大改（action=create_voice / 只收公网 url / prefix / 返回 voice_id）。
 *       本脚本用真实 API Key 验证哪种参数组合现在还能用。
 *
 * 用法：
 *   DASHSCOPE_KEY=sk-xxx node scripts/test-voice-clone.mjs
 *
 * 注意：T2/T3 会真的在百炼控制台创建音色（创建音色免费，但会占用音色额度），
 *       测完可在控制台「音色管理」里删掉。
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const KEY = process.env.DASHSCOPE_KEY || "";
if (!KEY) {
  console.error("缺少 DASHSCOPE_KEY 环境变量");
  process.exit(1);
}

const URL_BEIJING = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";
// 阿里云官方公开测试音频（公网可访问），用于验证新接口本身是否可用
const PUBLIC_SAMPLE = "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/cosyvoice/cosyvoice-zeroshot-sample.wav";

function toDataUrl(filePath) {
  const buf = readFileSync(filePath);
  const mime = filePath.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function probe(title, body) {
  console.log(`\n===== ${title} =====`);
  console.log("model:", body.model, "| action:", body.input?.action, "| target:", body.input?.target_model);
  const t0 = Date.now();
  try {
    const res = await fetch(URL_BEIJING, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`HTTP ${res.status}  (${Date.now() - t0}ms)`);
    console.log(text.slice(0, 600));
    return { status: res.status, text };
  } catch (e) {
    console.log(`请求异常: ${e.message}`);
    return { status: -1, text: String(e) };
  }
}

async function main() {
  // T1 老接口（qwen-voice-enrollment + base64）——预期已被下线，用来确认故障点
  await probe("T1 旧接口 qwen-voice-enrollment + base64（预期失败=已下线）", {
    model: "qwen-voice-enrollment",
    input: {
      action: "create",
      target_model: "qwen3-tts-vc-2026-01-22",
      preferred_name: "amadeus_test",
      audio: { data: toDataUrl(join(projectRoot, "public/voice_sample.mp3")) },
      language: "ja",
    },
  });

  // T2 新接口 + 公网 URL —— 验证新链路是否可用 + 看返回结构
  await probe("T2 新接口 voice-enrollment + 公网 url（验证新链路）", {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: "cosyvoice-v3.5-flash",
      prefix: "amadeus",
      url: PUBLIC_SAMPLE,
      language_hints: ["zh"],
    },
  });

  // T3 新接口 + base64 —— 关键：看官方没写出来的 base64 到底支不支持
  await probe("T3 新接口 voice-enrollment + base64（关键测试）", {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: "cosyvoice-v3.5-flash",
      prefix: "amadeus",
      audio: { data: toDataUrl(join(projectRoot, "public/voice_sample.mp3")) },
      language_hints: ["ja"],
    },
  });

  // T4 新接口 + audio.url 直接塞 data URL（另一种可能写法）
  await probe("T4 新接口 voice-enrollment + audio.url=dataURL", {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: "cosyvoice-v3.5-flash",
      prefix: "amadeus",
      audio: { url: toDataUrl(join(projectRoot, "public/voice_sample.mp3")) },
    },
  });

  console.log("\n===== 结论速查 =====");
  console.log("T1 失败(模型不存在) => 确认 qwen-voice-enrollment 已下线");
  console.log("T2 成功 => 新接口可用，但需要公网 URL");
  console.log("T3/T4 哪个成功 => 就用那种写法，不用 OSS 托管");
}

main();
