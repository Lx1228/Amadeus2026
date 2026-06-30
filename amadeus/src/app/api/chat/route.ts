import { NextResponse } from "next/server";
import { DEFAULT_PERSONALITY } from "@/lib/personality";

export async function POST(request: Request) {
  try {
    const { message, image, history, memories, personality, endpoint, apiKey, model } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ error: "请先设置 API Key" }, { status: 400 });
    }

    // 构建记忆上下文（截断注入：只发最近的，避免 input token 膨胀）
    // - fact：最多 5 条最新的
    // - summary：最多 1 条最新的（旧摘要已被新摘要覆盖，没必要全发）
    // - emotion：不发（性格倾向已在人设里，重复发浪费 token）
    let memoryContext = "";
    if (memories && memories.length > 0) {
      const facts = memories.filter((m: { type: string }) => m.type === "fact").slice(-5);
      const summaries = memories.filter((m: { type: string }) => m.type === "summary").slice(-1);

      const parts: string[] = [];
      if (facts.length > 0) {
        parts.push("事实：" + facts.map((m: { content: string }) => m.content).join("；"));
      }
      if (summaries.length > 0) {
        parts.push("过往对话摘要：" + summaries.map((m: { content: string }) => m.content).join("；"));
      }

      if (parts.length > 0) {
        memoryContext = "\n\n【记忆数据】以下是关于用户的长期信息（过去积累的事实，不是现在正在发生的事。当前时间见下方【当前时间】，判断是否过时）：\n" + parts.join("\n") + "\n";
      }
    }

    const chatHistory = history || [];

    // 提取上下文摘要（isSummary 的消息）作为 system 注入，不作为普通 history
    const summaryMessages = chatHistory.filter(
      (m: { isSummary?: boolean }) => m.isSummary
    );
    const normalHistory = chatHistory.filter(
      (m: { isSummary?: boolean }) => !m.isSummary
    );

    let summaryContext = "";
    if (summaryMessages.length > 0) {
      summaryContext = "\n\n【之前的对话摘要】\n" +
        summaryMessages.map((m: { content: string }) => m.content).join("\n") +
        "\n（以下是最近的对话，请基于上述摘要保持上下文连贯）";
    }

    // 构建用户消息（可能包含图片）
    let userMessage: { role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> };
    if (image) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
      ];
      if (message) {
        content.unshift({ type: "text", text: message });
      }
      userMessage = { role: "user", content };
    } else {
      userMessage = { role: "user", content: message };
    }

    const now = new Date();
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
    const timeContext = `\n\n【当前时间】${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（周${weekday}） ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}\n重要：上述是真实当前时间。判断用户行为是否合时宜（如深夜别催早起、下午别问吃没吃宵夜），不要基于过时记忆假设用户现在的状态。`;

    const messages = [
      { role: "system", content: (personality || DEFAULT_PERSONALITY) + memoryContext + summaryContext + timeContext },
      ...normalHistory,
      userMessage,
    ];

    // 诊断：打印实际发送给 LLM 的 payload 大小
    const llmPayload = JSON.stringify({ model, messages, max_tokens: 512 });
    const payloadBytes = Buffer.byteLength(llmPayload, "utf8");
    const systemLen = (personality || DEFAULT_PERSONALITY).length;
    const historyCount = normalHistory.length;
    const memoriesCount = memories?.length || 0;
    console.log(`[API] LLM payload: ${payloadBytes} bytes (${(payloadBytes / 1024).toFixed(1)} KB) | system ${systemLen}字 | history ${historyCount}条 | memories ${memoriesCount}条`);

    const t0 = Date.now();
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: llmPayload,
    });
    const fetchReturnMs = Date.now() - t0;
    console.log(`[API] fetch 返回(响应头到达): ${fetchReturnMs}ms, status=${res.status}`);

    // 上游错误（非 200）：错误体是 JSON，按原方式返回
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      let errMsg = "请求失败";
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errMsg;
      } catch {
        if (errText) errMsg = errText.slice(0, 200);
      }
      console.error("[API] LLM 上游错误:", res.status, errMsg);
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    // 非流式：上游返回完整 JSON，我们取出 reply 后用 SSE 格式一次性发给前端
    // 前端 Chat.tsx 仍然是 SSE 读取逻辑，不用改
    // 文字会一次性出现（不逐字），但总延迟远小于 stream 模式（MiMo stream 走慢队列）
    const data = await res.json();
    const reply: string = data.choices?.[0]?.message?.content || "无回复";
    const totalMs = Date.now() - t0;
    console.log(`[API] LLM 非流式响应耗时: ${totalMs}ms, 总字符数: ${reply.length}, messages 条数: ${messages.length}`);
    console.log(`[API] fetch返回→JSON解析完成: ${totalMs - fetchReturnMs}ms`);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 一次性把完整回复作为单个 SSE 事件发给前端
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: reply })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "请求失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
