import { NextResponse } from "next/server";

/**
 * 单轮 LLM 补全代理（2026-10-25）
 *
 * 为什么需要它：
 *   记忆提取（lib/memory.ts 的 extractMemories）和自动摘要（lib/sessions.ts 的
 *   summarizeOldMessages）原本是**浏览器直接 fetch 用户填的 endpoint**。
 *   跨域请求要求对方返回 CORS 头 —— 官方的小米 / DeepSeek 有，但用户自定义的
 *   第三方接口大多没有。结果就是：聊天正常（走 /api/chat 服务端转发），
 *   但记忆和摘要全部静默失败，表现成"它记不住我说过什么"。
 *
 *   改走本路由（同源、服务端转发）后，只要这个接口能聊天，就一定能提取记忆。
 *
 * 为什么不用 /api/chat：那个是流式 SSE + 人设/history/记忆注入，语义完全不同；
 * 这里要的是「给一段 prompt 拿一段纯文本」的最小调用。
 */
export async function POST(request: Request) {
  try {
    const { endpoint, apiKey, model, prompt, maxTokens } = await request.json();

    if (!endpoint || !apiKey || !model || !prompt) {
      return NextResponse.json({ error: "缺少 endpoint / apiKey / model / prompt" }, { status: 400 });
    }

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens || 512,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let errMsg = `上游 ${res.status}`;
      try {
        errMsg = JSON.parse(errText)?.error?.message || errMsg;
      } catch {
        if (errText) errMsg = `${errMsg}: ${errText.slice(0, 200)}`;
      }
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      return NextResponse.json({ error: "上游返回内容为空" }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
