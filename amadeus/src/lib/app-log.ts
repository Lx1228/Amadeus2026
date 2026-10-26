/**
 * 应用动作日志（2026-10-19，2026-10-25 加浏览器→服务端通道）
 * ========================================================
 * 「运行日志」面板的数据源是服务端环形缓冲（instrumentation.ts 抓的 console）。
 * 但设置面板里的操作都发生在**浏览器**，浏览器 console 不会进那个缓冲 ——
 * 所以 appLog 除了本地 console 留档，还要 POST 给 /api/app-logs 落进缓冲，
 * 面板才能看到"用户干了什么"（2026-10-25 用户要求：所有改动都要进日志）。
 *
 * ⚠️ 绝不能把 API Key 原文打进日志，只记长度/掩码。
 */

export function appLog(action: string, detail?: string | number) {
  const text = `[动作] ${action}${detail !== undefined && detail !== "" ? "：" + detail : ""}`;
  console.log(text);
  if (typeof window === "undefined") return; // 服务端 console 已被 instrumentation 抓走
  try {
    void fetch("/api/app-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 日志送不出去不影响功能 */
  }
}

export function appErr(action: string, detail?: unknown) {
  const text = detail instanceof Error ? detail.message : String(detail ?? "");
  console.error(`[动作] ${action}失败${text ? "：" + text : ""}`);
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/app-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[动作] ${action}失败${text ? "：" + text : ""}` }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 同上 */
  }
}
