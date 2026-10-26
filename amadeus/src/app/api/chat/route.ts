import { NextResponse } from "next/server";
import { DEFAULT_PERSONALITY } from "@/lib/personality";
import { selectFactsForPrompt } from "@/lib/memory";

export async function POST(request: Request) {
  try {
    const { message, image, history, memories, personality, endpoint, apiKey, model } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ error: "请先设置 API Key" }, { status: 400 });
    }

    // 构建记忆上下文（截断注入：只发最近的，避免 input token 膨胀）
    // - fact：2026-10-25 改成「全量去重 + 预算内取舍」，以前是只发最近 5 条，
    //   聊久了早期身份信息会被挤掉（见 lib/memory.ts 的 selectFactsForPrompt）
    // - summary：最多 1 条最新的（每次摘要都会把旧摘要一起滚进去，所以一条就够）
    // - emotion：不发（性格倾向已在人设里，重复发浪费 token）
    let memoryContext = "";
    if (memories && memories.length > 0) {
      const facts = selectFactsForPrompt(memories);
      const summaries = memories.filter((m: { type: string }) => m.type === "summary").slice(-1);

      const parts: string[] = [];
      if (facts.length > 0) {
        parts.push("事实：" + facts.join("；"));
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
    // stream:true → 流式，首字 1-2s 到达即开始逐字转发，体感远快于非流式（要等整段生成完）
    const llmPayload = JSON.stringify({ model, messages, max_tokens: 512, stream: true });
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

    // 流式转发：读上游 SSE，抽 delta.content，重封简化 SSE 逐字发给前端
    // 前端 Chat.tsx 的 SSE reader 逻辑能正确处理逐字 delta
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let firstTokenMs = 0;
    let totalChars = 0;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = res.body!.getReader();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE 事件以空行分隔，但上游每行一个 data:，按行切更稳
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
                if (delta) {
                  if (firstTokenMs === 0) {
                    firstTokenMs = Date.now() - t0;
                    console.log(`[API] 首字到达: ${firstTokenMs}ms (fetch返回→首字: ${firstTokenMs - fetchReturnMs}ms)`);
                  }
                  totalChars += delta.length;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                }
              } catch { /* 忽略解析失败的单行 */ }
            }
          }
          // flush 残留 buffer
          const tail = buffer.trim();
          if (tail.startsWith("data:")) {
            const payload = tail.slice(5).trim();
            if (payload && payload !== "[DONE]") {
              try {
                const parsed = JSON.parse(payload);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  totalChars += delta.length;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
                }
              } catch { /* 忽略 */ }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          const totalMs = Date.now() - t0;
          console.log(`[API] 流式完成: 总耗时 ${totalMs}ms | 首字 ${firstTokenMs}ms | 字符数 ${totalChars} | messages ${messages.length}条`);
        } catch (e) {
          console.error("[API] 流式读取异常:", e);
          try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); } catch { /* 已关闭 */ }
        }
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
