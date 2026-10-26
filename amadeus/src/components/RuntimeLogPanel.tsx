"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 运行日志面板（Settings → 运行日志，2026-10-18）
 * =====================================================
 * 给粉丝看的"黑窗口替代品"：语音服务在后台干什么、哪里报错，这里实时滚动。
 * 出了问题点「复制全部」发到群里就能排查。
 *
 * 数据一路：
 *   App 后台日志 —— /api/app-logs 增量拉取（聊天请求/路由报错），显示带 [应用] 前缀
 * （2026-10-25：语音服务日志 /api/tts/logs 与安装日志随本地语音模型功能一起删除）
 */

interface LogLine {
  key: string;
  ts: string;
  text: string;
}

/** 按内容粗略着色（终端风格的最低成本实现） */
function isErrorLine(text: string): boolean {
  return /失败|错误|异常|Traceback|ERROR|Error|❌|Exception|Failed|failed|HTTP [45]\d\d/i.test(text);
}

function lineColor(text: string): string {
  if (isErrorLine(text)) return "text-red-400";
  if (/⚠/.test(text)) return "text-amber-400";
  if (/完成|就绪|✅|ready/i.test(text)) return "text-green-400";
  return "text-zinc-300";
}

export default function RuntimeLogPanel() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 只看错误：粉丝看不懂日志，勾上只留红字 */
  const [errorsOnly, setErrorsOnly] = useState(false);
  const lastAppSeqRef = useRef(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  /** 按 key 去重合并进主日志流（安装日志轮询会反复拉到同一批行） */
  const mergeIntoLines = (batch: LogLine[]) => {
    setLines((prev) => {
      const keys = new Set(prev.map((l) => l.key));
      const fresh = batch.filter((b) => !keys.has(b.key));
      if (fresh.length === 0) return prev;
      const merged = [...prev, ...fresh];
      return merged.length > 400 ? merged.slice(-400) : merged;
    });
  };

  // 轮询 App 后台日志（2 秒一轮，增量）
  useEffect(() => {
    if (paused) return;
    let stop = false;
    const tick = async () => {
      const batch: LogLine[] = [];
      // App 后台（服务本进程，永远在线）
      try {
        const res = await fetch(`/api/app-logs?after=${lastAppSeqRef.current}`, { cache: "no-store" });
        const data = await res.json();
        if (stop) return;
        for (const l of data.lines ?? []) {
          batch.push({ key: `a${l.seq}`, ts: l.ts, text: `[应用] ${l.text}` });
        }
        if (typeof data.last === "number") lastAppSeqRef.current = data.last;
      } catch {
        /* 本进程接口，挂了也不用管 */
      }
      if (stop || batch.length === 0) return;
      batch.sort((a, b) => a.ts.localeCompare(b.ts));
      mergeIntoLines(batch);
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [paused]);

  // 新日志到达时自动滚到底部（用户往上翻了就不打扰）
  useEffect(() => {
    const box = boxRef.current;
    if (box && nearBottomRef.current) box.scrollTop = box.scrollHeight;
  }, [lines]);

  /** 错误行 ——「复制报错」只复制这些，避免刷屏 */
  const errorLines = () => {
    return lines
      .filter((l) => isErrorLine(l.text))
      .map((l) => `[${l.ts}] ${l.text}`);
  };

  const copyErrors = async () => {
    const errs = errorLines();
    try {
      await navigator.clipboard.writeText(
        errs.length > 0 ? errs.join("\n") : "（没有发现报错日志）"
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板权限被拒时静默 */
    }
  };

  return (
    <div className="space-y-3">
      {/* 状态行 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0 bg-green-500" />
          <span className="text-xs font-mono text-zinc-400 truncate">
            应用运行日志（云端语音模式，走阿里云 API）
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          <button
            onClick={() => setPaused((v) => !v)}
            className="text-xs font-mono text-zinc-400 hover:text-white transition-colors"
            title={paused ? "继续自动刷新" : "暂停自动刷新（复制前建议暂停）"}
          >
            {paused ? "▶ 继续刷新" : "⏸ 暂停刷新"}
          </button>
          <label className="flex items-center gap-1 text-xs font-mono text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
              className="accent-[#D18B24]"
            />
            只看错误
          </label>
          <button
            onClick={copyErrors}
            className="px-3 py-1.5 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-xs"
            title="只复制红色的报错日志（连安装失败原因一起），发群里不刷屏"
          >
            {copied ? "已复制 ✓" : "复制报错"}
          </button>
        </div>
      </div>

      {/* 语音服务终端 */}
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-80 overflow-y-auto bg-black/70 border border-zinc-700 rounded-lg p-3 font-mono text-[11px] leading-relaxed select-text break-words"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-600">
            等待日志输出…（聊天请求、云端语音合成、复刻音色、报错都会出现在这里）
          </p>
        ) : (
          lines
            .filter((l) => !errorsOnly || isErrorLine(l.text))
            .map((l) => (
            <div key={l.key} className={lineColor(l.text)}>
              <span className="text-zinc-600 mr-2">{l.ts}</span>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
