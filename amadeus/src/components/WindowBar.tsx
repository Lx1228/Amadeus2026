"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 自绘窗口标题栏（2026-10-25）
 *
 * 背景：应用改成了无边框窗口（decorations = false），系统标题栏消失，
 * 所以「拖动窗口 / 最小化 / 关闭」这三件事要自己做。
 *
 * 右上角按钮的排列（从左到右）和坐标约定 —— 改位置要同步改 Chat.tsx / LoginForm.tsx：
 *     设置   right-[8.5rem]   ← Chat.tsx（登录页没有这个按钮）
 *     BGM    right-[6rem]     ← Chat.tsx / LoginForm.tsx（两个页面位置一致）
 *     最小化 right-[3.5rem]
 *     关闭   right-[1rem]
 * BGM 故意紧挨最小化：登录页只有 3 个按钮、聊天页 4 个，如果 BGM 按顺序排，
 * 两个页面的图标位置就会错开（用户反馈"进聊天页图标要挪位"）。
 * 把"设置"放到最左边，BGM 位置就恒定。
 *
 * 拖动窗口（2026-10-25 第二次修）：
 *   一开始用的是 Tauri 的 `data-tauri-drag-region`，实测在
 *   decorations:false + resizable:false 的窗口上**不生效** ——
 *   DOM 检查确认拖动条没被遮挡（elementFromPoint 命中的就是它自己、
 *   z-index 25、pointer-events auto），但按住拖不动。
 *   所以改成自己发 Win32 消息（Rust 侧 start_drag 命令）。
 */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** 拿到 Tauri 注入的 invoke（不用动态 import，拖动要零延迟） */
function getInvoke(): InvokeFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } };
  const f = w.__TAURI_INTERNALS__?.invoke;
  return typeof f === "function" ? f : null;
}

export default function WindowBar() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const quit = useCallback(async () => {
    const invoke = getInvoke();
    if (!invoke) {
      // 浏览器里调试：没有桌面壳，降级为关标签页
      window.close();
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await invoke("quit_app");
      // 正常情况下进程会直接结束，走不到这里。
      // 走得到说明命令返回了但进程没退 —— 复位，别把 UI 锁死。
      setBusy(false);
      setErr("退出命令已发送，但进程没有结束。可以改用托盘图标右键退出。");
    } catch (e) {
      // 2026-10-25 用户反馈"一直停在退出中、取消也点不动"：
      // 之前 busy 时把取消按钮 disable 了，命令一旦失败用户就完全没退路。
      // 现在失败要复位 + 说清原因，取消永远可点。
      setBusy(false);
      setErr(`退出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const minimize = useCallback(() => {
    void getInvoke()?.("minimize_window")?.catch(() => {});
  }, []);

  // 关闭弹窗里的「最小化」：隐藏到托盘（屏幕和任务栏都不留，
  // 只剩右下角托盘图标），跟顶栏「—」的最小化到任务栏区分开。
  const hideToTray = useCallback(() => {
    void getInvoke()?.("hide_window")?.catch(() => {});
  }, []);

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // 不要 await：start_drag 内部是 SendMessage，会阻塞到拖动结束才返回
    void getInvoke()?.("start_drag")?.catch(() => {});
  }, []);

  // Esc 取消；确认框打开时按 Enter 直接退出
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmOpen(false);
      } else if (e.key === "Enter" && !busy) {
        e.preventDefault();
        void quit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, quit, busy]);

  return (
    <>
      {/* 拖动条：按住可以拖窗口。
          z-index 压在页面内容之上（Chat 的 header 设了 pointer-events-none 让事件穿透）、
          按钮之下，所以顶部这条能拖，按钮照样能点。 */}
      <div
        onMouseDown={onDragMouseDown}
        data-amadeus-drag=""
        className="absolute top-0 left-0 right-0 h-[3.5rem] cursor-default"
        style={{ zIndex: 25 }}
      />

      {/* 最小化 */}
      <button
        onClick={minimize}
        className="absolute right-[3.5rem] top-4 p-2 text-zinc-400 hover:text-white transition-colors"
        style={{ zIndex: 60 }}
        aria-label="最小化"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
        </svg>
      </button>

      {/* 关闭（→ 退出确认） */}
      <button
        onClick={() => {
          setErr("");
          setConfirmOpen(true);
        }}
        className="absolute right-4 top-4 p-2 text-zinc-400 hover:text-red-400 transition-colors"
        style={{ zIndex: 60 }}
        aria-label="关闭"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 关闭确认框（2026-10-25 用户要求跟常见应用一致）：
          两个选项「最小化 / 退出」+ 框右上角小叉取消 */}
      {confirmOpen && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
          style={{ zIndex: 120 }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="relative w-[26rem] rounded-xl border border-[#D18B24]/60 bg-[#12100e]/95 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗自己的叉：取消 */}
            <button
              onClick={() => setConfirmOpen(false)}
              className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 transition-colors hover:text-white"
              aria-label="取消"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="px-6 pt-5 pb-1 pr-12">
              <h2 className="text-base font-mono tracking-wide text-[#F2B03A]">关闭 Amadeus？</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                最小化会收进右下角托盘，点托盘图标随时弹回来。
                <br />
                退出会结束程序，聊天记录保存在本地，不会丢失。
              </p>
              {err && <p className="mt-2 text-xs leading-relaxed text-red-400">{err}</p>}
            </div>
            <div className="mt-4 flex gap-3 border-t border-zinc-700/60 px-6 py-4">
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  hideToTray();
                }}
                className="flex-1 rounded-lg border border-zinc-600 px-4 py-2 text-sm font-mono text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
              >
                最小化
              </button>
              <button
                onClick={() => void quit()}
                disabled={busy}
                className="flex-1 rounded-lg border border-red-500/60 bg-red-500/15 px-4 py-2 text-sm font-mono text-red-300 transition-colors hover:bg-red-500/25 hover:text-red-200 disabled:opacity-60"
              >
                {busy ? "退出中..." : "退出"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
