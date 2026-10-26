import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * 会话文件备份（2026-10-18）
 * ============================
 * 聊天记录存在浏览器 localStorage 里，清 WebView2 缓存会连带全丢——粉丝清缓存的
 * 概率不低。这里把每次会话保存镜像一份到服务端文件：
 *
 *   %APPDATA%\com.amadeus.kurisu\sessions\sessions_{characterId}.json
 *
 * 该目录不在 WebView 缓存里、不在安装目录里（重装/更新都不丢）。App 启动时若
 * 发现本地为空/比备份旧，从这份文件自动恢复（见 lib/sessions.ts）。
 */

/** 备份上限 25MB：正常纯文本会话远小于此，防异常 payload 撑爆磁盘 */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function storageDir(): string {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "com.amadeus.kurisu", "sessions");
}

/** 角色 ID 白名单：只允许字母数字下划线连字符，防路径穿越 */
function safeName(id: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export async function GET(request: Request) {
  const cid = new URL(request.url).searchParams.get("characterId") || "";
  const safe = safeName(cid);
  if (!safe) {
    return NextResponse.json({ error: "bad characterId" }, { status: 400 });
  }
  const file = join(storageDir(), `sessions_${safe}.json`);
  try {
    if (!existsSync(file)) {
      return NextResponse.json({ exists: false });
    }
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return NextResponse.json({ exists: true, ...parsed });
  } catch (e) {
    // 备份文件损坏按"无备份"处理，别挡住正常启动
    return NextResponse.json({ exists: false, error: String(e) });
  }
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
    const payload = {
      savedAt: Number(body.savedAt) || Date.now(),
      activeId: String(body.activeId || ""),
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
    };
    const dir = storageDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `sessions_${safe}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, file); // 原子替换，断电也不会留半截文件
    return NextResponse.json({ ok: true, savedAt: payload.savedAt });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
