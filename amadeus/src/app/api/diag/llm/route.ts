import { NextResponse } from "next/server";

/**
 * 纯 LLM 诊断端点：绕过所有应用逻辑（人设/history/memory/格式解析），
 * 用最小 payload 直接打 MiMo，测真实响应时间。
 *
 * 用法：POST /api/diag/llm  body: { endpoint, apiKey, model, stream?: bool }
 * 返回：{ fetchMs, firstChunkMs, totalMs, chars, content }
 */
export async function POST(request: Request) {
  const { endpoint, apiKey, model, stream = false } = await request.json();

  if (!apiKey || !endpoint || !model) {
    return NextResponse.json({ error: "需要 endpoint, apiKey, model" }, { status: 400 });
  }

  // 最小 payload：1 条 system + 1 条 user，没有人设没有 history
  const messages = [
    { role: "system", content: "你是助手，简短回复。" },
    { role: "user", content: "你好" },
  ];

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: 50,
    stream,
  });

  const payloadSize = Buffer.byteLength(body, "utf8");
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
    console.log(`[DIAG] payload ${payloadSize} bytes, fetch 返回 ${fetchMs}ms, status ${res.status}`);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `上游 ${res.status}: ${errText.slice(0, 200)}`, fetchMs, payloadSize }, { status: 502 });
    }

    if (stream) {
      // 流式：测首 chunk + 总时间
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let firstChunkMs = 0;
      let totalChars = 0;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstChunkMs) {
          firstChunkMs = Date.now() - t0;
          console.log(`[DIAG] stream 首 chunk: ${firstChunkMs}ms (fetch→首chunk: ${firstChunkMs - fetchMs}ms)`);
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) totalChars += delta.length;
          } catch { /* */ }
        }
      }

      const totalMs = Date.now() - t0;
      console.log(`[DIAG] stream 完成: 总 ${totalMs}ms, ${totalChars} 字符, 首→末: ${totalMs - firstChunkMs}ms`);
      return NextResponse.json({ fetchMs, firstChunkMs, totalMs, chars: totalChars, payloadSize, stream: true });
    } else {
      // 非流式
      const data = await res.json();
      const totalMs = Date.now() - t0;
      const content = data.choices?.[0]?.message?.content || "";
      console.log(`[DIAG] 非流式完成: 总 ${totalMs}ms, ${content.length} 字符`);
      return NextResponse.json({ fetchMs, totalMs, chars: content.length, content: content.slice(0, 100), payloadSize, stream: false });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: msg, fetchMs: Date.now() - t0, payloadSize }, { status: 500 });
  }
}
