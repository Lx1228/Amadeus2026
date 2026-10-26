import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * 被裁撤会话的隐藏备份（2026-10-26）
 * ============================================================
 * 新版本强制"一个角色只保留一个会话"（用户拍板）。升级时多余会话
 * 不直接销毁，而是由前端 POST 到这里，追加合并进：
 *
 *   %APPDATA%\com.amadeus.kurisu\sessions\discarded_{characterId}.json
 *
 * 该文件没有任何 UI 入口——纯兜底，万一粉丝后悔还能手工捞回。
 * 没有对应 GET：不需要在界面呈现，捞回是作者手工操作的事。
 */

const MAX_BODY_BYTES = 25 * 1024 * 1024;
/** 单角色归档上限：超过就丢最旧的，防止文件无限膨胀 */
const MAX_ARCHIVED_SESSIONS = 50;

function storageDir(): string {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "com.amadeus.kurisu", "sessions");
}

function safeName(id: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    const body = JSON.parse(raw);
    const safe = safeName(String(body.characterId || ""));
    if (!safe) {
      return NextResponse.json({ error: "bad characterId" }, { status: 400 });
    }
    const incoming: unknown[] = Array.isArray(body.sessions) ? body.sessions : [];
    if (incoming.length === 0) {
      return NextResponse.json({ ok: true, archived: 0 });
    }

    const dir = storageDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `discarded_${safe}.json`);

    // 合并：已有的归档 + 本批（按 id 去重，新数据覆盖旧数据）
    const existing: { archivedAt: number; sessions: unknown[] } = (() => {
      try {
        if (existsSync(file)) {
          const parsed = JSON.parse(readFileSync(file, "utf-8"));
          if (Array.isArray(parsed.sessions)) return parsed;
        }
      } catch {
        /* 归档文件损坏就重开一份 */
      }
      return { archivedAt: 0, sessions: [] };
    })();

    const byId = new Map<string, unknown>();
    for (const s of existing.sessions as Array<{ id?: string }>) {
      if (s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string") {
        byId.set((s as { id: string }).id, s);
      }
    }
    for (const s of incoming as Array<{ id?: string }>) {
      if (s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string") {
        byId.set((s as { id: string }).id, s);
      }
    }
    // 超上限丢最旧（数组顺序即插入顺序）
    let merged = Array.from(byId.values());
    if (merged.length > MAX_ARCHIVED_SESSIONS) {
      merged = merged.slice(merged.length - MAX_ARCHIVED_SESSIONS);
    }

    const payload = { archivedAt: Date.now(), sessions: merged };
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, file);
    return NextResponse.json({ ok: true, archived: incoming.length, total: merged.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
