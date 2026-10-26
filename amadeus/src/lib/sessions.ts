import { MemoryEntry } from "./memory";
import { getSessionCharacterId } from "./auth";
import { getRandomGreeting as getCharacterGreeting, DEFAULT_CHARACTER } from "./characters";
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
  /**
   * 已经并入长期摘要的消息条数（2026-10-25）
   * 摘要不删原文，只靠这个游标记录进度，下次只摘要增量部分。
   */
  summarizedUpTo?: number;
}

const DEFAULT_SESSION_NAME = "默认会话";

// === 会话存储按角色 ID 隔离 ===
// 不同角色用不同的 localStorage key，互不干扰
function getSessionsKey(): string {
  const charId = typeof window !== "undefined" ? getSessionCharacterId() : DEFAULT_CHARACTER.id;
  return `amadeus_sessions_${charId}`;
}
function getActiveSessionKey(): string {
  const charId = typeof window !== "undefined" ? getSessionCharacterId() : DEFAULT_CHARACTER.id;
  return `amadeus_active_session_${charId}`;
}

// 兼容旧版本（红莉栖角色 ID = kurisu）的迁移 key
const LEGACY_SESSIONS_KEY = "amadeus_sessions";
const LEGACY_ACTIVE_SESSION_KEY = "amadeus_active_session";
const OLD_MESSAGES_KEY = "amadeus_messages";
const OLD_MEMORIES_KEY = "amadeus_memories";

// 测试数据清洗（2026-10-26）：自动化测试造的假数据曾通过备份同步混进真实账号。
// ① 会话名"测试会话"→"默认会话"；② 剔除测试假消息（精确匹配特征串，
//    绝不误伤真实内容）；③ 剔除测试塞的 8 条假事实记忆（内容精确已知）；
// ④ summarizedUpTo 游标按删减后的消息数收敛，防止整理进度越界。
const FAKE_TEST_MSG_RE = /^第\d+条：我们聊了话题\d+$/;
const FAKE_TEST_FACTS = new Set([
  "用户叫小明",
  "用户是程序员",
  "用户住在东莞",
  "用户喜欢喝咖啡",
  "用户养了一只猫",
  "用户在学日语",
  "用户喜欢命运石之门",
  "用户最近在找工作",
]);

function sanitizeTestSession(sessions: Session[]): Session[] {
  return sessions.map((s) => {
    let out = s.name === "测试会话" ? { ...s, name: "默认会话" } : s;
    const hasFakeMsg = out.messages.some((m) => FAKE_TEST_MSG_RE.test(m.content));
    const hasFakeMem = out.memories.some((m) => FAKE_TEST_FACTS.has(m.content));
    if (!hasFakeMsg && !hasFakeMem) return out;
    const messages = out.messages.filter((m) => !FAKE_TEST_MSG_RE.test(m.content));
    const memories = out.memories.filter((m) => !FAKE_TEST_FACTS.has(m.content));
    out = {
      ...out,
      messages,
      memories,
      summarizedUpTo: Math.min(out.summarizedUpTo ?? 0, messages.length),
    };
    console.log(
      `[Sessions] 清理测试残留：剔除 ${s.messages.length - messages.length} 条假消息、${s.memories.length - memories.length} 条假记忆`
    );
    return out;
  });
}

// === 单会话强制迁移（2026-10-26，用户拍板）===
// 新版一个角色只保留一个会话：保留**当前活跃**的那条（升级后接着聊，无感知），
// 多余的会话 POST 到 /api/sessions/discarded 存进服务端隐藏归档文件
// （discarded_{角色}.json，无 UI 入口，纯兜底可手工捞回）。
// 幂等：每个角色只归档一次（localStorage 标记），之后靠过滤兜底。
function enforceSingleSession(sessions: Session[]): Session[] {
  if (sessions.length <= 1) return sessions;
  const charId = getSessionCharacterId();
  const activeId = loadActiveSessionId();
  const keep =
    sessions.find((s) => s.id === activeId) ??
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const discarded = sessions.filter((s) => s.id !== keep.id);

  const flagKey = `amadeus_single_session_migrated_${charId}`;
  if (localStorage.getItem(flagKey) !== "1") {
    localStorage.setItem(flagKey, "1");
    console.log(
      `[Sessions] 单会话模式：保留当前会话（${keep.messages.length} 条），其余 ${discarded.length} 个会话已存入本地归档文件`
    );
    void fetch("/api/sessions/discarded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: charId, sessions: discarded }),
    }).catch(() => {});
  }
  return [keep];
}

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  const sessionsKey = getSessionsKey();
  // 优先读角色专属 key
  const saved = localStorage.getItem(sessionsKey);
  if (saved) return enforceSingleSession(sanitizeTestSession(JSON.parse(saved)));
  // 迁移：红莉栖角色首次切到新 key 时，从旧 key 复制
  const charId = getSessionCharacterId();
  if (charId === DEFAULT_CHARACTER.id) {
    const legacy = localStorage.getItem(LEGACY_SESSIONS_KEY);
    if (legacy) {
      localStorage.setItem(sessionsKey, legacy);
      return enforceSingleSession(sanitizeTestSession(JSON.parse(legacy)));
    }
  }
  return [];
}

export function saveSessions(sessions: Session[]) {
  localStorage.setItem(getSessionsKey(), JSON.stringify(sessions));
  queueBackup(sessions);
}

// === 文件备份（防清 WebView2 缓存丢聊天记录，2026-10-18）===
// 本地仍是主存储（同步读写）；每次保存后异步镜像到服务端文件
// （%APPDATA%\com.amadeus.kurisu\sessions\，清缓存/重装都不丢）。
// App 启动时 restoreSessionsFromBackup() 发现本地空/比备份旧就自动恢复。

function backupAtKey(): string {
  const charId = typeof window !== "undefined" ? getSessionCharacterId() : DEFAULT_CHARACTER.id;
  return `amadeus_sessions_backup_at_${charId}`;
}

function queueBackup(sessions: Session[]) {
  if (typeof window === "undefined") return;
  const charId = getSessionCharacterId();
  const savedAt = Date.now();
  try {
    localStorage.setItem(backupAtKey(), String(savedAt));
  } catch {
    /* 本地标记写失败不影响备份 */
  }
  // 发后不管：备份失败只影响新鲜度，本地永远是权威数据
  void fetch("/api/sessions/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      characterId: charId,
      savedAt,
      activeId: loadActiveSessionId(),
      sessions,
    }),
  }).catch(() => {});
}

/** 启动时调用：本地没有会话（或比备份旧）时从服务端文件恢复。返回是否发生了恢复。 */
export function restoreSessionsFromBackup(): Promise<boolean> {
  const charId = typeof window !== "undefined" ? getSessionCharacterId() : "";
  if (!charId) return Promise.resolve(false);
  return fetch(`/api/sessions/backup?characterId=${encodeURIComponent(charId)}`)
    .then((r) => r.json())
    .then((d) => {
      if (!d?.exists || !Array.isArray(d.sessions) || d.sessions.length === 0) return false;
      const localAt = Number(localStorage.getItem(backupAtKey()) || 0);
      if ((Number(d.savedAt) || 0) <= localAt) return false; // 本地更新，不覆盖
      localStorage.setItem(
        getSessionsKey(),
        JSON.stringify(enforceSingleSession(sanitizeTestSession(d.sessions)))
      );
      if (d.activeId) {
        localStorage.setItem(getActiveSessionKey(), String(d.activeId));
      }
      localStorage.setItem(backupAtKey(), String(d.savedAt));
      return true;
    })
    .catch(() => false);
}

export function loadActiveSessionId(): string {
  if (typeof window === "undefined") return "";
  const activeKey = getActiveSessionKey();
  const saved = localStorage.getItem(activeKey);
  if (saved) return saved;
  // 迁移
  const charId = getSessionCharacterId();
  if (charId === DEFAULT_CHARACTER.id) {
    return localStorage.getItem(LEGACY_ACTIVE_SESSION_KEY) || "";
  }
  return "";
}

function saveActiveSessionId(id: string) {
  localStorage.setItem(getActiveSessionKey(), id);
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
      messages: oldMessages ? JSON.parse(oldMessages) : [{ role: "assistant" as const, content: getCharacterGreeting(getSessionCharacterId()) }],
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

// 2026-10-18：设置页去掉「新开会话」后，只剩 ensureDefaultSession 会自动建首个会话。
// createSession 已删除（保留会让死代码检查报警，也让"一个会话"的模型更清楚）。

export function updateSession(
  id: string,
  updates: Partial<Pick<Session, "name" | "messages" | "memories" | "summarizedUpTo">>
) {
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

// 2026-10-18：设置面板改为只读（只导出/压缩），删除与重命名入口已随 UI 移除，
// deleteSession / renameSession 一并删除。

// === 上下文摘要（2026-10-25 重写为「非破坏性」）===
//
// 旧实现是删除式压缩：把旧消息删掉、换成一条 isSummary 消息。
// 粉丝反馈"远一点的聊天记录不记得"，但直接把压缩改成自动触发会有新问题：
// 用户会发现聊天记录凭空少了一截，这比"不记得"更容易让人炸。
//
// 所以改成：
//   - 摘要另存进 session.memories（type: "summary"），由 /api/chat 注入 system
//   - 原始消息一条不删，本地记录永远完整
//   - 用 summarizedUpTo 记录"已摘要到第几条"，下次只摘要增量
//   - 每次摘要都把旧摘要一起滚进去，所以永远只有一条、且不会丢历史

/** 未摘要的消息超过这个数就触发一次摘要 */
export const AUTO_SUMMARY_THRESHOLD = 30;
/** 最近这么多条原文永远不纳入摘要，保证当下对话连贯 */
export const KEEP_RECENT = 20;
/** 一次至少攒够这么多条才值得多花一次 LLM 调用 */
const MIN_SUMMARIZE_BATCH = 10;

const SUMMARY_PROMPT = `把下面的对话并入已有摘要，输出一段连贯的第三人称摘要（不超过 300 字）。

要求：
- 保留关键信息：聊过的话题、用户的偏好和立场、重要决定、未完成的事、约定
- 丢弃闲聊、重复内容、已经解决的细节
- 如果给了【已有摘要】，必须把它和新对话融合成一段，不要简单拼接
- 不要分条、不要加标题，直接输出摘要正文

`;

export interface SummarizeResult {
  /** 本次并入摘要的消息条数 */
  summarized: number;
  /** 合并后的完整摘要 */
  summary: string;
}

/**
 * 把"较旧的对话"总结进长期记忆。**不会修改 session.messages**。
 * @returns null = 不需要摘要 / 没有 API Key / 调用失败
 */
export async function summarizeOldMessages(
  sessionId: string,
  config: { endpoint: string; apiKey: string; model: string }
): Promise<SummarizeResult | null> {
  if (!config.apiKey) return null;

  const session = loadSessions().find((s) => s.id === sessionId);
  if (!session) return null;

  // isSummary 是旧版压缩留下的摘要消息，本身不是对话，不参与新摘要
  const msgs = session.messages.filter((m) => !m.isSummary);
  const cursor = session.summarizedUpTo ?? 0;
  const end = msgs.length - KEEP_RECENT;
  if (end - cursor < MIN_SUMMARIZE_BATCH) return null;

  const batch = msgs.slice(cursor, end);
  const prevSummary =
    session.memories.filter((m) => m.type === "summary").slice(-1)[0]?.content || "";

  const dialogText = batch
    .map((m) => {
      const text = m.content.slice(0, 500);
      const prefix = m.imageUrl ? "[发了图片] " : "";
      return `${m.role === "user" ? "用户" : "Amadeus"}: ${prefix}${text}`;
    })
    .join("\n");

  const prompt =
    SUMMARY_PROMPT +
    (prevSummary ? `【已有摘要】${prevSummary}\n\n【新增对话】\n` : "") +
    dialogText;

  try {
    // 2026-10-25：改走服务端代理 /api/llm（同源）。
    // 原来浏览器直连用户 endpoint，自定义接口没 CORS 头时会被拦掉，
    // 表现为"摘要一直不生效、模型永远记不住旧对话"。
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        prompt,
        maxTokens: 600,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const summary: string = (data?.text || "").trim();
    if (!summary) return null;

    const summaryEntry: MemoryEntry = {
      id: `sum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: summary,
      timestamp: Date.now(),
      type: "summary",
    };
    // 只留一条 summary：新的已经包含旧的内容
    const memories = [
      ...session.memories.filter((m) => m.type !== "summary"),
      summaryEntry,
    ];

    updateSession(sessionId, { memories, summarizedUpTo: end });
    return { summarized: batch.length, summary };
  } catch {
    return null;
  }
}
