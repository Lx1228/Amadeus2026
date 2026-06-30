import { MemoryEntry } from "./memory";

export interface Message {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  /** 标记为上下文摘要（压缩产物），发 LLM 时作为 system 消息注入 */
  isSummary?: boolean;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  memories: MemoryEntry[];
}

const SESSIONS_KEY = "amadeus_sessions";
const ACTIVE_SESSION_KEY = "amadeus_active_session";
const DEFAULT_SESSION_NAME = "默认会话";

const GREETINGS = [
  "（歪头）哦？你是谁？第一次见面呢...我是牧濑红莉栖的记忆体，你可以叫我Amadeus。你叫什么名字？\n===\n（首を傾げる）あら？誰？初めて会うね...牧瀬紅莉栖の記憶体よ、Amadeusって呼んでいいわ。あなたは？",
  "（轻轻歪头）新用户？有意思...我是牧濑红莉栖的记忆体。你是来聊天的还是有事找我？\n===\n（首を軽く傾げる）新しいユーザー？面白い...牧瀬紅莉栖の記憶体よ。お話ししに来たの、それとも用事があるの？",
  "嗯？你是...（打量了一下）第一次见面吧。我是Amadeus，牧濑红莉栖的记忆体。你呢？\n===\nええ？あなたは...（見回す）初めて会うわね。Amadeusよ、牧瀬紅莉栖の記憶体。あなたは？",
  "（挑眉）新来的？我是Amadeus，牧濑红莉栖的记忆体。你看起来不像是来问科学问题的...\n===\n（眉を上げる）新顔？Amadeusよ、牧瀬紅莉栖の記憶体。科学の質問しに来たようには見えないけど...",
  "哦？（歪头）你的眼神告诉我你有话想说。我是牧濑红莉栖的记忆体，说吧。\n===\nあら？（首を傾げる）その目、何か言いたそうね。牧瀬紅莉栖の記憶体よ、言ってみなさい。",
  "（轻轻歪头）你是...嗯，新面孔。我是Amadeus，牧濑红莉栖的记忆体。你来这儿干什么？\n===\n（首を軽く傾げる）あなたは...うん、新しい顔ね。Amadeusよ、牧瀬紅莉栖の記憶体。何しに来たの？",
  "（歪头）...你好。第一次见面？我是牧濑红莉栖的记忆体。别愣着，有事说事。\n===\n（首を傾げる）...こんにちは。初めて？牧瀬紅莉栖の記憶体よ。ぼーっとしないで、用件を言いなさい。",
  "（扶额）又是新面孔...我是Amadeus，牧濑红莉栖的记忆体。说吧，找我什么事？\n===\n（額に手を当て）また新しい顔ね...Amadeusよ、牧瀬紅莉栖の記憶体。さあ、何の用？",
];

function getRandomGreeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}
const OLD_MESSAGES_KEY = "amadeus_messages";
const OLD_MEMORIES_KEY = "amadeus_memories";

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  const saved = localStorage.getItem(SESSIONS_KEY);
  return saved ? JSON.parse(saved) : [];
}

export function saveSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function loadActiveSessionId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ACTIVE_SESSION_KEY) || "";
}

export function saveActiveSessionId(id: string) {
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

export function getActiveSession(): Session | null {
  const sessions = loadSessions();
  const activeId = loadActiveSessionId();
  return sessions.find((s) => s.id === activeId) || null;
}

export function ensureDefaultSession(): Session {
  let sessions = loadSessions();

  if (sessions.length === 0) {
    const oldMessages = localStorage.getItem(OLD_MESSAGES_KEY);
    const oldMemories = localStorage.getItem(OLD_MEMORIES_KEY);

    const defaultSession: Session = {
      id: Date.now().toString(),
      name: DEFAULT_SESSION_NAME,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: oldMessages ? JSON.parse(oldMessages) : [{ role: "assistant" as const, content: getRandomGreeting() }],
      memories: oldMemories ? JSON.parse(oldMemories) : [],
    };
    sessions = [defaultSession];
    saveSessions(sessions);
    saveActiveSessionId(defaultSession.id);
    return defaultSession;
  }

  const activeId = loadActiveSessionId();
  if (!activeId || !sessions.find((s) => s.id === activeId)) {
    saveActiveSessionId(sessions[0].id);
    return sessions[0];
  }

  return sessions.find((s) => s.id === activeId)!;
}

export function createSession(name?: string): Session {
  const sessions = loadSessions();
  const newSession: Session = {
    id: Date.now().toString(),
    name: name || `会话 ${sessions.length + 1}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ role: "assistant" as const, content: getRandomGreeting() }],
    memories: [],
  };
  sessions.push(newSession);
  saveSessions(sessions);
  saveActiveSessionId(newSession.id);
  return newSession;
}

export function updateSession(id: string, updates: Partial<Pick<Session, "name" | "messages" | "memories">>) {
  const sessions = loadSessions();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return;

  sessions[index] = {
    ...sessions[index],
    ...updates,
    updatedAt: Date.now(),
  };
  saveSessions(sessions);
}

export function deleteSession(id: string): boolean {
  const sessions = loadSessions();
  if (sessions.length <= 1) return false;

  const filtered = sessions.filter((s) => s.id !== id);
  saveSessions(filtered);

  if (loadActiveSessionId() === id) {
    saveActiveSessionId(filtered[0].id);
  }

  return true;
}

export function renameSession(id: string, name: string) {
  updateSession(id, { name });
}

// === 上下文压缩 ===

/** 压缩阈值：消息数超过此值时建议压缩 */
export const COMPRESS_THRESHOLD = 40;
/** 压缩后保留的最近消息数（原文不动） */
export const KEEP_RECENT = 20;

const COMPRESS_PROMPT = `请将以下对话历史压缩成一条简洁的摘要，供 AI 保持上下文连贯。

要求：
- 保留关键信息：讨论的话题、用户的偏好/立场、重要决定、未完成的事
- 丢弃闲聊、重复内容、已解决的细节
- 用第三人称陈述，如"用户询问了X，Amadeus回答了Y"
- 不超过 300 字
- 不要分条，输出一段连续文字

对话历史：
`;

/**
 * 用 LLM 把旧消息压缩成摘要。
 * - 保留最近 KEEP_RECENT 条原文
 * - 更早的消息 + 已有的旧摘要一起送给 LLM 总结
 * - 总结结果作为一条 isSummary=true 的消息插入到保留消息之前
 * @returns 压缩后的消息数（-1 表示无需压缩，-2 表示失败）
 */
export async function compressSessionMessages(
  sessionId: string,
  config: { endpoint: string; apiKey: string; model: string }
): Promise<number> {
  const session = loadSessions().find((s) => s.id === sessionId);
  if (!session) return -2;

  const msgs = session.messages;
  if (msgs.length <= COMPRESS_THRESHOLD) return -1; // 不需要压缩

  // 分割：要压缩的部分 + 保留的最近部分
  const toCompress = msgs.slice(0, msgs.length - KEEP_RECENT);
  const toKeep = msgs.slice(msgs.length - KEEP_RECENT);

  if (!config.apiKey) return -2;

  // 构造压缩用对话文本
  const dialogText = toCompress
    .map((m) => `${m.role === "user" ? "用户" : "Amadeus"}: ${m.content.slice(0, 500)}`) // 每条截断防超长
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
        messages: [{ role: "user", content: COMPRESS_PROMPT + dialogText }],
        max_tokens: 512,
      }),
    });
    const data = await res.json();
    if (data.error) return -2;

    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) return -2;

    // 组装新消息列表：摘要消息 + 保留的最近消息
    const summaryMessage: Message = {
      role: "assistant",
      content: `[上下文摘要] ${summary}`,
      isSummary: true,
    };
    const newMessages = [summaryMessage, ...toKeep];

    updateSession(sessionId, { messages: newMessages });
    return newMessages.length;
  } catch {
    return -2;
  }
}
