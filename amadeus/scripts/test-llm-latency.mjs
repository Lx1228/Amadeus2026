/**
 * 独立 LLM 延迟测试脚本 —— 完全绕过 Next.js
 *
 * 用法：
 *   node scripts/test-llm-latency.mjs
 *
 * 然后按提示输入 endpoint / apiKey / model
 * （可以直接复制 localStorage 里 amadeus_model_config 的值）
 */
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

async function testOnce(endpoint, apiKey, model, label) {
  const messages = [
    { role: "system", content: "你是助手，简短回复。" },
    { role: "user", content: "你好" },
  ];
  const body = JSON.stringify({ model, messages, max_tokens: 50 });

  console.log(`\n[${label}] 开始测试...`);
  const t0 = Date.now();

  try {
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    const fetchMs = Date.now() - t0;
    console.log(`[${label}] fetch 返回: ${fetchMs}ms, status: ${res.status}`);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.log(`[${label}] 错误: ${errText.slice(0, 200)}`);
      return;
    }

    const data = await res.json();
    const totalMs = Date.now() - t0;
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`[${label}] 总耗时: ${totalMs}ms, 回复: ${content.slice(0, 60)}`);
    console.log(`[${label}] fetch→JSON: ${totalMs - fetchMs}ms`);
  } catch (e) {
    console.log(`[${label}] 异常: ${e.message}`);
  }
}

async function main() {
  console.log("=== LLM 延迟独立测试（绕过 Next.js）===\n");

  // 从环境变量或用户输入获取配置
  let endpoint = process.argv[2] || await ask("Endpoint (如 https://api.xiaomimimo.com/v1): ");
  let apiKey = process.argv[3] || await ask("API Key: ");
  let model = process.argv[4] || await ask("Model (如 mimo-v2.5): ");

  endpoint = endpoint.trim();
  apiKey = apiKey.trim();
  model = model.trim();

  console.log(`\n配置: endpoint=${endpoint}, model=${model}, key=***${apiKey.slice(-4)}`);

  // 连测 3 次，看是否稳定
  for (let i = 1; i <= 3; i++) {
    await testOnce(endpoint, apiKey, model, `第${i}次`);
  }

  console.log("\n=== 测试完成 ===");
  console.log("如果 3 次都 >8s → 模型商当前确实慢（凌晨高峰/限流），代码无能为力");
  console.log("如果 3 次都 <3s → Next.js 链路有问题，应用代码需要排查");
  console.log("如果时快时慢 → 模型商负载不均");

  rl.close();
}

main();
