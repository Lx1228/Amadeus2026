import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * App 后台运行日志（2026-10-18）。
 *
 * instrumentation.ts 把本进程的 console 输出抓进 globalThis 上的环形缓冲，
 * 这里增量吐给「运行日志」面板——格式与语音服务的 /logs 保持一致，
 * 面板把两路日志按时间合并显示（[应用] / [语音] 前缀区分）。
 */

interface AppLogLine {
  seq: number;
  ts: string;
  text: string;
}

export async function GET(request: Request) {
  const g = globalThis as unknown as { __amadeusLogBuf?: AppLogLine[] };
  const buf = g.__amadeusLogBuf ?? [];
  const after = Number(new URL(request.url).searchParams.get("after") || 0);

  const lines = Number.isFinite(after) ? buf.filter((l) => l.seq > after) : [];
  const last = buf.length > 0 ? buf[buf.length - 1].seq : Number.isFinite(after) ? after : 0;

  return NextResponse.json({ lines, last, total: buf.length });
}

/**
 * 浏览器动作日志入口（2026-10-25）。
 *
 * 设置面板里的操作（切接口、存 Key、开关语音、复刻音色……）都发生在浏览器，
 * 浏览器 console 进不了 instrumentation 的服务端缓冲 —— 前端 appLog 会 POST 到这里，
 * 落进同一个环形缓冲，「运行日志」面板就能看到用户的每一步操作。
 * 注意：这里**不打** console（缓冲 already 收了，再打会重复一条）。
 */
export async function POST(request: Request) {
  const g = globalThis as unknown as {
    __amadeusLogBuf?: AppLogLine[];
    __amadeusLogSeq?: number;
  };
  if (!g.__amadeusLogBuf) {
    return NextResponse.json({ ok: false, error: "log buffer not ready" }, { status: 503 });
  }

  let text = "";
  try {
    const body = await request.json();
    text = String(body?.text ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  text = text.replace(/\s+$/, "").slice(0, 500);
  if (!text) return NextResponse.json({ ok: true });

  g.__amadeusLogSeq = (g.__amadeusLogSeq ?? 0) + 1;
  g.__amadeusLogBuf.push({
    seq: g.__amadeusLogSeq,
    ts: new Date().toTimeString().slice(0, 8),
    text,
  });
  if (g.__amadeusLogBuf.length > 500) {
    g.__amadeusLogBuf.splice(0, g.__amadeusLogBuf.length - 500);
  }
  return NextResponse.json({ ok: true });
}
