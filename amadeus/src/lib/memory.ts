export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  type: "fact" | "emotion" | "summary";
}

const MEMORY_KEY = "amadeus_memories";

export function loadMemories(): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  const saved = localStorage.getItem(MEMORY_KEY);
  return saved ? JSON.parse(saved) : [];
}

export function saveMemories(memories: MemoryEntry[]) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
}

export function addMemory(content: string, type: MemoryEntry["type"] = "fact") {
  const memories = loadMemories();
  const newMemory: MemoryEntry = {
    id: Date.now().toString(),
    content,
    timestamp: Date.now(),
    type,
  };
  memories.push(newMemory);
  saveMemories(memories);
  return newMemory;
}

export function deleteMemory(id: string) {
  const memories = loadMemories().filter((m) => m.id !== id);
  saveMemories(memories);
}

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
    const res = await fetch(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
      }),
    });
    const data = await res.json();
    if (data.error) return [];

    const text = data.choices[0].message.content;
    return text
      .split("\n")
      .filter((line: string) => line.trim().startsWith("- ["))
      .map((line: string) => line.replace(/^-\s*\[[^\]]+\]\s*/, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const MAX_MEMORIES = 100;
const COMPRESS_AGE_DAYS = 7;

const COMPRESS_PROMPT = `将以下多条记忆压缩成一条简洁的摘要，保留所有关键信息。

要求：
- 每条摘要不超过50字
- 保留人物、事件、偏好等关键信息
- 用分号分隔不同要点

待压缩的记忆：
`;

export async function compressOldMemories(
  config: { endpoint: string; apiKey: string; model: string }
): Promise<void> {
  const memories = loadMemories();
  if (memories.length <= MAX_MEMORIES) return;

  const now = Date.now();
  const ageThreshold = now - COMPRESS_AGE_DAYS * 24 * 60 * 60 * 1000;

  const oldMemories = memories
    .filter((m) => m.timestamp < ageThreshold && m.type !== "summary")
    .sort((a, b) => a.timestamp - b.timestamp);

  if (oldMemories.length < 5) return;

  const toCompress = oldMemories.slice(0, oldMemories.length - 20);

  if (!config.apiKey) return;

  try {
    const prompt = COMPRESS_PROMPT + toCompress.map((m) => `- ${m.content}`).join("\n");
    const res = await fetch(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 256,
      }),
    });
    const data = await res.json();
    if (data.error) return;

    const summary = data.choices[0].message.content.trim();
    const idsToRemove = new Set(toCompress.map((m) => m.id));

    const compressed: MemoryEntry = {
      id: Date.now().toString(),
      content: summary,
      timestamp: now,
      type: "summary",
    };

    const updated = [
      ...memories.filter((m) => !idsToRemove.has(m.id)),
      compressed,
    ];

    saveMemories(updated);
  } catch {
    // 压缩失败不影响正常使用
  }
}
