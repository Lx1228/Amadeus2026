export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  type: "fact" | "emotion" | "summary";
}

/** 事实记忆注入的总字符预算（大概 600~800 token 量级） */
const FACT_BUDGET_CHARS = 2000;

/**
 * 挑选要注入 prompt 的事实记忆（2026-10-25）
 *
 * 以前 api/chat/route.ts 里是 `facts.slice(-5)` —— 只发最近 5 条。
 * 聊得越久记忆攒得越多，早期那条"我叫什么、什么职业"会被后来的琐事挤出去，
 * 表现就是"它不记得我了"。
 *
 * 现在的策略：全部注入（去重），只在超出字符预算时做取舍 ——
 * 保留最早的 20%（通常是身份类信息，最重要）+ 尽可能多的最新记忆。
 */
export function selectFactsForPrompt(
  memories: { content: string; type: string }[]
): string[] {
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const m of memories) {
    if (m.type !== "fact") continue;
    const c = (m.content || "").trim();
    if (!c || seen.has(c)) continue; // 去重：同一条事实被反复提取很常见
    seen.add(c);
    facts.push(c);
  }

  const cost = (list: string[]) => list.reduce((n, f) => n + f.length + 1, 0);
  if (cost(facts) <= FACT_BUDGET_CHARS) return facts;

  const headCount = Math.max(1, Math.floor(facts.length * 0.2));
  const head = facts.slice(0, headCount);
  let used = cost(head);
  const tail: string[] = [];
  for (let i = facts.length - 1; i >= headCount; i--) {
    const c = facts[i].length + 1;
    if (used + c > FACT_BUDGET_CHARS) break;
    tail.unshift(facts[i]);
    used += c;
  }
  return [...head, ...tail];
}

// 注意：记忆数据实际存在 session 里（见 sessions.ts 的 Session.memories），
// 早期版本这里还有一套 localStorage 读写（loadMemories/saveMemories/
// addMemory/deleteMemory/compressOldMemories），已被 session 方案取代，
// 2026-10-12 清理时删除。

const EXTRACT_PROMPT = `分析以下对话，提取需要长期记住的关键信息。

【只提取长期有效的事实，不要提取瞬时状态】
要提取的：
- 用户的固定信息：名字、职业、家乡、生日、性格特点
- 长期偏好：喜欢的食物/音乐/游戏/作者、固定的习惯（如每天跑步）
- 重要关系：家庭成员、宠物、长期朋友
- 重大事件：毕业、换工作、搬家（这些是已发生的人生节点）

不要提取的（瞬时/过时即弃）：
- 正在做的临时动作：在吃饭、在睡觉、在上班、在打游戏、在看剧
- 当前时间相关：今天/昨晚/刚才做了什么、几点了、现在心情如何
- 还未发生的事：准备去吃、待会要做什么、明天计划
- 寒暄/闲聊：你好、晚安、在吗、吃饭了吗

判断标准：这条信息一周后还有意义吗？没有就别提取。

格式要求（每条一行）：
- [事实] 长期有效的用户信息或偏好
- [情感] 用户表现出的稳定性格倾向（不是当下情绪）

如果没有值得记住的内容，返回空。

对话：
`;

export async function extractMemories(
  conversation: { role: string; content: string }[],
  config: { endpoint: string; apiKey: string; model: string }
): Promise<string[]> {
  if (!config.apiKey) return [];

  const recentConversation = conversation.slice(-10);
  const prompt = EXTRACT_PROMPT + recentConversation
    .map((m) => `${m.role === "user" ? "用户" : "Amadeus"}: ${m.content}`)
    .join("\n");

  try {
    // 2026-10-25：改走服务端代理 /api/llm，不再浏览器直连用户的 endpoint。
    // 直连时自定义接口没有 CORS 头会被浏览器拦掉，表现为记忆静默失效。
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        prompt,
        maxTokens: 512,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text: string = data?.text || "";
    if (!text) return [];

    return text
      .split("\n")
      .filter((line: string) => line.trim().startsWith("- ["))
      .map((line: string) => line.replace(/^-\s*\[[^\]]+\]\s*/, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
