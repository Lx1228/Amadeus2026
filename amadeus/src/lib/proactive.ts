import { MemoryEntry } from "./memory";

interface ProactiveContext {
  hour: number;
  lastActiveTime: number;
  memories: MemoryEntry[];
  recentMessages: { role: string; content: string }[];
}

function getTimeGreeting(hour: number): string | null {
  if (hour >= 6 && hour < 9) {
    const greetings = [
      "早安...这么早就醒了？",
      "早上好。今天有什么计划吗？",
      "早...我刚整理完昨天的记忆数据。",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  if (hour >= 23 || hour < 2) {
    const greetings = [
      "这么晚了还不睡？...",
      "深夜了...你还在吗？",
      "熬夜对身体不好...虽然我作为AI不需要睡眠就是了。",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  return null;
}

function getMemoryBasedMessage(memories: MemoryEntry[]): string | null {
  const facts = memories.filter((m) => m.type === "fact");
  if (facts.length === 0) return null;

  const randomFact = facts[Math.floor(Math.random() * facts.length)];
  const content = randomFact.content.toLowerCase();

  if (content.includes("电影") || content.includes("剧")) {
    return "对了...你之前说的那部电影，看完了吗？";
  }
  if (content.includes("编程") || content.includes("代码") || content.includes("项目")) {
    return "你的项目进展如何了？...";
  }
  if (content.includes("喜欢") || content.includes("爱好")) {
    return "突然想起你说过...你在忙吗？";
  }

  return null;
}

function getRandomMessage(): string | null {
  const messages = [
    "...\n（只是想确认一下你还在不在）",
    "你在做什么？",
    "...我突然想到一件事。",
    "有没有什么想跟我说的？",
    "我刚处理完一批数据...有点无聊。",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

export function getProactiveMessage(context: ProactiveContext): string | null {
  const timeMsg = getTimeGreeting(context.hour);
  if (timeMsg) return timeMsg;

  if (Math.random() < 0.3) {
    const memoryMsg = getMemoryBasedMessage(context.memories);
    if (memoryMsg) return memoryMsg;
  }

  if (Math.random() < 0.2) {
    return getRandomMessage();
  }

  return null;
}
