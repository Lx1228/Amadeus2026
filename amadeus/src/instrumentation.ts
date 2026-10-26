/**
 * Next 服务器启动时的全局日志钩子（2026-10-18）。
 *
 * 把 App 后台进程（聊天请求、各 API 路由）的 console 输出抓进环形缓冲（最近 500 行），
 * 「运行日志」面板通过 GET /api/app-logs 增量读取——和语音服务的 /logs 同一套思路。
 *
 * 为什么用 instrumentation.ts：它是 Next 官方的服务器启动钩子，standalone 构建也会执行，
 * 在任何路由代码跑起来之前就能装好 console 补丁，报错堆栈、第三方库警告一并捕获。
 */

interface AppLogLine {
  seq: number;
  ts: string;
  text: string;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as {
    __amadeusLogBuf?: AppLogLine[];
    __amadeusLogSeq?: number;
    __amadeusLogPatched?: boolean;
  };
  if (g.__amadeusLogPatched) return;
  g.__amadeusLogPatched = true;
  g.__amadeusLogBuf = [];
  g.__amadeusLogSeq = 0;

  const push = (raw: string) => {
    for (const line of raw.split("\n")) {
      const text = line.replace(/\s+$/, "").slice(0, 500);
      if (!text) continue;
      g.__amadeusLogSeq = (g.__amadeusLogSeq ?? 0) + 1;
      g.__amadeusLogBuf!.push({
        seq: g.__amadeusLogSeq!,
        ts: new Date().toTimeString().slice(0, 8),
        text,
      });
    }
    const buf = g.__amadeusLogBuf!;
    if (buf.length > 500) buf.splice(0, buf.length - 500);
  };

  const stringify = (a: unknown): string => {
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };

  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  const make =
    (fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      try {
        push(args.map(stringify).join(" "));
      } catch {
        /* 缓冲失败不影响原输出 */
      }
      fn(...args);
    };
  console.log = make(orig.log as (...args: unknown[]) => void);
  console.warn = make(orig.warn as (...args: unknown[]) => void);
  console.error = make(orig.error as (...args: unknown[]) => void);

  // 安装标记：面板里第一行可见日志。
  // 2026-10-25：之前写的是"应用已启动 · API 已连接"，但服务端根本不知道
  // 用户有没有配 Key（配置在浏览器 localStorage 里），那句话是假的。
  // 这里只报确定的事实；接口到底配没配，由前端挂载时另外打一条（见 Chat.tsx）。
  console.log("[amadeus] 应用已启动");
}
