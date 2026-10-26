"use client";

import { useState, useEffect } from "react";
import { loadSessions, loadActiveSessionId, Session, summarizeOldMessages, AUTO_SUMMARY_THRESHOLD, KEEP_RECENT } from "@/lib/sessions";
import {
  loadTTSConfig, saveTTSConfig, TTSConfig,
} from "@/lib/tts";
import { setSessionLoggedIn } from "@/lib/auth";
import { getSessionCharacterId } from "@/lib/auth";
import { getCharacterById } from "@/lib/characters";
import { appLog, appErr } from "@/lib/app-log";
import {
  CLOUD_MODEL,
  loadAliyunKey,
  loadCloudVoices,
  saveAliyunKey,
  saveCloudVoice,
} from "@/lib/cloud-tts";
import {
  getProviders,
  isCustomProvider,
  loadCustomEndpoint,
  loadCustomModel,
  loadKeyForProvider,
  loadModelConfig,
  normalizeEndpoint,
  saveCustomEndpoint,
  saveCustomModel,
  saveKeyForProvider,
  saveModelConfig,
  ModelConfig,
} from "@/lib/model-config";
import { parseMessage } from "@/lib/message-parser";
import RuntimeLogPanel from "./RuntimeLogPanel";

/** 把时间戳格式化成 YYYY-MM-DD HH:mm:ss */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 把会话导出为 TXT 文本（含完整聊天记录），弹出系统保存对话框让用户选位置 */
async function exportSessionToTxt(session: Session, characterName: string): Promise<{ saved: boolean; path?: string; cancelled?: boolean }> {
  if (typeof window === "undefined") return { saved: false };

  const lines: string[] = [];
  lines.push("========================================");
  lines.push("  Amadeus 聊天记录");
  lines.push("========================================");
  lines.push(`会话名称：${session.name}`);
  lines.push(`创建时间：${formatTime(session.createdAt)}`);
  lines.push(`最后更新：${formatTime(session.updatedAt)}`);
  lines.push(`消息总数：${session.messages.length} 条`);
  lines.push("");
  lines.push("========================================");
  lines.push("");
  lines.push("");

  for (const msg of session.messages) {
    const speaker = msg.role === "user" ? "我" : characterName;
    let content: string;
    if (msg.role === "assistant") {
      const parsed = parseMessage(msg.content);
      content = parsed.zh;
    } else {
      content = msg.content;
    }
    const prefix = (msg as { isSummary?: boolean }).isSummary ? "[上下文摘要] " : "";
    lines.push(`【${speaker}】`);
    lines.push(`${prefix}${content}`);
    if (msg.imageUrl) lines.push("[图片]");
    lines.push("");
    lines.push("----------------------------------------");
    lines.push("");
  }

  lines.push("");
  lines.push("========================================");
  lines.push(`导出于 ${formatTime(Date.now())}`);
  lines.push("========================================");

  const BOM = "\uFEFF";
  const text = BOM + lines.join("\n");

  const safeName = session.name.replace(/[\\/:*?"<>|]/g, "_");
  const exportTime = formatTime(Date.now()).replace(/[: ]/g, "-");
  const txtFilename = `${safeName}_${exportTime}.txt`;

  // === 用 showSaveFilePicker 保存 TXT ===
  const w2 = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle> };
  if (typeof w2.showSaveFilePicker === "function") {
    try {
      const handle = await w2.showSaveFilePicker({
        suggestedName: txtFilename,
        types: [{ description: "文本文件", accept: { "text/plain": [".txt"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { saved: true, path: handle.name };
    } catch (e) {
      if (e instanceof DOMException && (e.name === "AbortError" || e.name === "NotAllowedError")) {
        return { saved: false, cancelled: true };
      }
      console.warn("[Export] showSaveFilePicker failed, fallback to Blob download:", e);
    }
  }

  // 回退：Blob 下载
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = txtFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { saved: true, path: "下载目录" };
}


interface SettingsProps {
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}

const MENU_ITEMS = [
  { id: "chat-model", label: "Chat模型" },
  { id: "tts", label: "语音合成" },
  { id: "memory", label: "会话管理" },
  { id: "logs", label: "运行日志" },
];

export default function Settings({ open, onClose, onSave }: SettingsProps) {
  const [activeTab, setActiveTab] = useState("chat-model");
  const PROVIDERS = getProviders();
  const [config, setConfig] = useState<ModelConfig>(loadModelConfig);
  const [showKey, setShowKey] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [compressingId, setCompressingId] = useState<string | null>(null);
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(loadTTSConfig);
  // 当前登录角色（用于动态显示角色名）
  const character = getCharacterById(getSessionCharacterId());

  const [toast, setToast] = useState<string | null>(null);
  // 2026-10-25：本地语音模型功能已整个删除，语音合成只走云端（CosyVoice）。
  const [aliyunKey, setAliyunKey] = useState("");
  const [cloudVoices, setCloudVoices] = useState<Record<string, string>>({});
  const [showCloudKey, setShowCloudKey] = useState(false);
  const [cloning, setCloning] = useState(false);

  /** 一键复刻三个角色的云端音色（免费，约 10 秒） */
  const cloneAllVoices = async () => {
    const key = aliyunKey.trim();
    if (!key) {
      showToast("请先填写阿里云 API Key");
      return;
    }
    saveAliyunKey(key);
    setCloning(true);
    const ids = ["kurisu", "maho", "may"];
    const next = { ...cloudVoices };
    let okCount = 0;
    let lastError = "";
    /** 把阿里云的英文报错翻成粉丝看得懂的话 */
    const zhError = (msg: string) => {
      if (/api-key|api key|invalid|unauthorized|401/i.test(msg)) {
        return "API Key 无效，请在百炼控制台确认后重填";
      }
      if (/too short/i.test(msg)) return "音色样本太短，无法复刻";
      if (/quota|arrear|balance|欠费|额度|402/i.test(msg)) {
        return "账号额度不足，请到阿里云百炼充值后再试";
      }
      return msg;
    };
    for (const id of ids) {
      try {
        const res = await fetch("/api/tts/cloud/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: id, apiKey: key }),
        });
        const data = await res.json();
        if (res.ok && data.voiceId) {
          saveCloudVoice(id, data.voiceId);
          next[id] = data.voiceId;
          okCount += 1;
          appLog("音色复刻成功", id);
        } else {
          lastError = String(data.error || `HTTP ${res.status}`);
          appErr("音色复刻", `${id}：${lastError}`);
        }
      } catch (e) {
        appErr("音色复刻", `${id}：${e instanceof Error ? e.message : "网络异常"}`);
      }
    }
    setCloudVoices(next);
    setCloning(false);
    showToast(
      okCount === 3
        ? "三个音色复刻完成，可以开始说话了"
        : `复刻完成 ${okCount}/3 — ${zhError(lastError || "未知原因")}`
    );
  };

  useEffect(() => {
    if (!open) return; // 挂载(open=false)时不记，面板真正打开才记一次
    setConfig(loadModelConfig());
    setSessions(loadSessions());
    setActiveSessionId(loadActiveSessionId());
    setTTSConfig(loadTTSConfig());
    setAliyunKey(loadAliyunKey());
    setCloudVoices(loadCloudVoices());
  }, [open]);

  const provider = PROVIDERS[config.provider] || PROVIDERS.xiaomi;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // 通知 Chat 组件设置已变更，需实时重载（模型 / TTS 配置即时生效）
  const notifyChange = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("amadeus-settings-change"));
    }
  };

  // 所有 hook 必须在这个 return 之前执行完。
  // 放在中间的 useEffect 会让 open 关闭时 hook 数量变少，
  // React 抛 "error #310: Rendered more hooks than during the previous render" 直接崩页。
  if (!open) return null;

  const handleProviderChange = (value: string) => {
    // 2026-10-25：这里**不**再做"把当前 key 存回当前槽"的动作。
    // 因为 config.apiKey 可能是老版本遗留的共享 key（别家的），
    // 一存就把脏值固化进当前提供商的槽里，以后每次切回来都会被回填。
    // key 只在用户真正在输入框里改的时候才写槽（见 onChange）。
    const keyForTarget = loadKeyForProvider(value);

    // 自定义接口（2026-10-25 接回）：endpoint / model 由用户手填。
    // 这里刻意**不**把上一家的地址预填进来 —— 之前那版会预填小米的地址和
    // mimo-v2.6-pro，用户以为"系统自动帮我选了小米"，实际是自己的配置没生效。
    // 改用自己的记忆：上次填过就恢复，从没填过就是空的 + 占位提示。
    if (isCustomProvider(value)) {
      const updated = {
        provider: value,
        endpoint: loadCustomEndpoint(),
        apiKey: keyForTarget,
        model: loadCustomModel(),
      };
      setConfig(updated);
      saveModelConfig(updated);
      notifyChange();
      appLog("切换 Chat 接口", "自定义接口");
      showToast("已切换到自定义接口，请填写接口地址和模型名");
      return;
    }
    const p = PROVIDERS[value];
    const updated = { provider: value, endpoint: p.endpoints[0], apiKey: keyForTarget, model: p.models[0] };
    setConfig(updated);
    saveModelConfig(updated);
    notifyChange();
    appLog("切换 Chat 接口", p.name);
    showToast(`已切换到 ${p.name}`);
  };

  const handleCompressSession = async (id: string) => {
    setCompressingId(id);
    try {
      const cfg = loadModelConfig();
      const result = await summarizeOldMessages(id, cfg);
      if (result) {
        setSessions(loadSessions());
        appLog("整理会话记忆", `${result.summarized} 条旧对话并入长期记忆`);
        showToast(`已把 ${result.summarized} 条旧对话并入长期记忆（原文保留）`);
      } else {
        showToast("暂时不用整理：消息还不够，或 API Key / 网络有问题");
      }
    } catch {
      showToast("整理失败");
    } finally {
      setCompressingId(null);
    }
  };

  const handleExportSession = async (session: Session) => {
    try {
      const result = await exportSessionToTxt(session, character.name);
      if (result.cancelled) {
        showToast("已取消导出");
      } else if (result.saved) {
        appLog("导出会话 TXT", `${session.messages.length} 条消息`);
        showToast(`已导出 ${session.messages.length} 条消息 → ${result.path || "本地"}`);
      } else {
        showToast("导出失败");
      }
    } catch (e) {
      showToast(`导出失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  return (
    // 2026-10-25：用 absolute 而不是 fixed。外层 ViewportScaler 改用 CSS zoom 后
    // 不再像 transform 那样建立包含块，fixed 会相对**整个窗口**定位，
    // 窗口比例和舞台比例不一致时遮罩会盖不满/盖过头。absolute 相对舞台，永远正确。
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl h-[500px] flex overflow-hidden"
      >
        {/* 左侧菜单 */}
        <div className="w-48 shrink-0 bg-zinc-950 border-r border-zinc-700 p-4">
          <h2 className="text-sm font-mono text-zinc-500 mb-4 px-2">设置</h2>
          <nav className="space-y-1">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono whitespace-nowrap transition-colors ${
                  activeTab === item.id
                    ? "bg-[#8C4F14]/50 text-[#F2B03A]"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* 右侧内容 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <h2 className="text-lg font-mono text-[#F2B03A]">
              {MENU_ITEMS.find((m) => m.id === activeTab)?.label ?? "设置"}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // 用 location.replace 强制整页刷新到登录页，绕过 React 状态更新 + 组件卸载的开销
                  setSessionLoggedIn(false);
                  appLog("退出登录");
                  window.location.replace("/login");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/40 hover:bg-red-900/70 border border-red-700 rounded-lg text-xs font-mono text-red-300 hover:text-red-200 transition-colors"
              >
                退出登录
              </button>
              <button onClick={onClose} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-xs font-mono text-zinc-300 hover:text-white transition-colors">
                返回聊天
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
            {activeTab === "chat-model" && (
              <>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1 font-mono">模型提供商</label>
                  <select
                    value={config.provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white"
                  >
                    {Object.entries(PROVIDERS).map(([key, p]) => (
                      <option key={key} value={key}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1 font-mono">接口协议</label>
                  {isCustomProvider(config.provider) ? (
                    <>
                      <input
                        type="text"
                        value={config.endpoint}
                        onChange={(e) => {
                          // 输入即保存（跟预设接口下拉一致）：只靠 onBlur 保存的话，
                          // 用户填完直接关面板就可能丢掉刚填的地址
                          const next = { ...config, endpoint: e.target.value };
                          setConfig(next);
                          saveModelConfig(next);
                          saveCustomEndpoint(e.target.value); // 单独记一份，切走再切回不丢
                          notifyChange();
                        }}
                        onBlur={(e) => {
                          // 用 DOM 里的真实值，别依赖闭包里的 state
                          const ep = normalizeEndpoint(e.target.value);
                          const next = { ...config, endpoint: ep };
                          setConfig(next);
                          saveModelConfig(next);
                          saveCustomEndpoint(ep);
                          notifyChange();
                          showToast(ep ? "接口地址已保存" : "接口地址为空，聊天会失败");
                          if (ep) appLog("修改自定义接口地址", ep);
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="https://你的接口地址/v1"
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500 font-mono">
                        填 OpenAI 兼容地址，到 /v1 为止（不带 /chat/completions）
                      </p>
                    </>
                  ) : (
                    <select
                      value={config.endpoint}
                      onChange={(e) => {
                        setConfig({ ...config, endpoint: e.target.value });
                        saveModelConfig({ ...config, endpoint: e.target.value });
                        notifyChange();
                        appLog("切换接口地址", e.target.value);
                        showToast("已切换接口");
                      }}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white"
                    >
                      {provider.endpoints.map((ep) => (
                        <option key={ep} value={ep}>{ep}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1 font-mono">API Key</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showKey ? "text" : "password"}
                        value={config.apiKey}
                        onChange={(e) => {
                          // 只更新本地 state，不自动保存——防浏览器覆盖。
                          // 但按提供商记一份（切走再切回不丢，也不会串到别家）
                          setConfig({ ...config, apiKey: e.target.value });
                          saveKeyForProvider(config.provider, e.target.value);
                        }}
                        autoComplete="off"
                        name="amadeus-model-key"
                        placeholder="输入你的 API Key"
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500 pr-16"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                      >
                        {showKey ? "隐藏" : "显示"}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        saveModelConfig(config);
                        saveKeyForProvider(config.provider, config.apiKey);
                        notifyChange();
                        appLog("保存 Chat 接口 Key", `${config.provider}（${config.apiKey.length} 字符）`);
                        showToast(`API Key 已保存（${config.apiKey.length} 字符）`);
                      }}
                      className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm whitespace-nowrap"
                    >
                      保存
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1 font-mono">模型</label>
                  {isCustomProvider(config.provider) ? (
                    <>
                      <input
                        type="text"
                        value={config.model}
                        onChange={(e) => {
                          const next = { ...config, model: e.target.value };
                          setConfig(next);
                          saveModelConfig(next);
                          saveCustomModel(e.target.value); // 单独记一份，切走再切回不丢
                          notifyChange();
                        }}
                        onBlur={(e) => {
                          const m = e.target.value.trim();
                          const next = { ...config, model: m };
                          setConfig(next);
                          saveModelConfig(next);
                          saveCustomModel(m);
                          notifyChange();
                          showToast(m ? `模型已设为 ${m}` : "模型名为空，聊天会失败");
                          if (m) appLog("设置自定义模型名", m);
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="模型名，例如 gpt-4o-mini"
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500 font-mono">
                        按服务商文档填，必须和接口支持的模型名完全一致
                      </p>
                    </>
                  ) : (
                    <select
                      value={config.model}
                      onChange={(e) => {
                        setConfig({ ...config, model: e.target.value });
                        saveModelConfig({ ...config, model: e.target.value });
                        notifyChange();
                        appLog("切换 Chat 模型", e.target.value);
                        showToast(`已切换到 ${e.target.value}`);
                      }}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white"
                    >
                      {provider.models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            )}

            {activeTab === "tts" && (
              <div className="space-y-5">
                {/* ===== 云端配置（唯一引擎，2026-10-25 本地模型已删） ===== */}
                <div className="space-y-3">
                  <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-mono text-zinc-200">阿里云 API Key</h4>
                      <span className="text-xs font-mono text-zinc-500">{CLOUD_MODEL}</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={showCloudKey ? "text" : "password"}
                        value={aliyunKey}
                        onChange={(e) => {
                          setAliyunKey(e.target.value);
                          saveAliyunKey(e.target.value);
                        }}
                        onBlur={(e) => {
                          if (e.target.value.trim()) appLog("保存阿里云 API Key", `${e.target.value.trim().length} 字符`);
                        }}
                        placeholder="sk-...（你自己的百炼 API Key）"
                        className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                      />
                      <button
                        onClick={() => setShowCloudKey(!showCloudKey)}
                        className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-mono text-xs"
                      >
                        {showCloudKey ? "隐藏" : "显示"}
                      </button>
                    </div>
                  </div>

                  <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-mono text-zinc-200">音色复刻</h4>
                      <button
                        onClick={() => void cloneAllVoices()}
                        disabled={cloning}
                        className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm disabled:opacity-50"
                      >
                        {cloning ? "复刻中…" : "一键复刻三个角色"}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {[
                        { id: "kurisu", name: "牧濑红莉栖" },
                        { id: "maho", name: "比屋定真帆" },
                        { id: "may", name: "椎名真由理" },
                      ].map((c) => (
                        <div key={c.id} className="flex items-center justify-between text-xs font-mono">
                          <span className="text-zinc-300">{c.name}</span>
                          <span className={cloudVoices[c.id] ? "text-green-400" : "text-amber-400"}>
                            {cloudVoices[c.id] ? "已复刻" : "未复刻"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 启用开关 */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-mono text-zinc-200">启用</h3>
                  </div>
                  <button
                    onClick={() => {
                      const updated = { ...ttsConfig, enabled: !ttsConfig.enabled };
                      setTTSConfig(updated);
                      saveTTSConfig(updated);
                      notifyChange();
                      showToast(updated.enabled ? "语音合成已开启" : "语音合成已关闭");
                      appLog("语音合成", updated.enabled ? "已开启（云端 CosyVoice）" : "已关闭");
                    }}
                    className={`w-12 h-6 rounded-full transition-colors relative ${
                      ttsConfig.enabled ? "bg-[#D18B24]" : "bg-zinc-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                        ttsConfig.enabled ? "translate-x-6" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

              </div>
            )}

            {activeTab === "memory" && (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                  {sessions.map((session) => {
                    const summarized = session.summarizedUpTo ?? 0;
                    // 还能整理多少条（最近 KEEP_RECENT 条永远保留原文）
                    const pending = session.messages.length - summarized - KEEP_RECENT;
                    const autoOn = session.messages.length > AUTO_SUMMARY_THRESHOLD;
                    return (
                      <div
                        key={session.id}
                        // 2026-10-25 重排：原来一行塞了 4 条信息，文字换行成两行、
                        // 按钮被挤成竖排。现在拆成「信息区 + 操作区」上下两层，
                        // 按钮各占一半宽度，不会再换行。
                        className="rounded-lg border border-zinc-700 bg-zinc-800/50 overflow-hidden"
                      >
                        <div className="px-4 py-3">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xl leading-none font-mono text-zinc-100">
                              {session.messages.length}
                            </span>
                            <span className="text-xs font-mono text-zinc-400">条消息</span>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed font-mono text-zinc-500">
                            {summarized > 0 ? `已整理 ${summarized} 条旧对话` : "还没有整理过"}
                            <span className="mx-1.5 text-zinc-600">·</span>
                            {autoOn ? "自动整理已开启" : `超过 ${AUTO_SUMMARY_THRESHOLD} 条自动整理`}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 border-t border-zinc-700/60">
                          <button
                            onClick={() => handleExportSession(session)}
                            className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono whitespace-nowrap text-blue-400 hover:text-blue-300 hover:bg-zinc-800/60 transition-colors"
                            title="导出为 TXT 文件保存到本地"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            导出 TXT
                          </button>
                          <button
                            onClick={() => {
                              // 灰态也给个解释：disabled 按钮的 title 在浏览器里
                              // 往往不弹，用户只会看到"点不动"，很困惑（2026-10-25）
                              if (pending < 10) {
                                showToast(
                                  `还需要再聊 ${10 - pending} 条才能整理（最近 ${KEEP_RECENT} 条会保留原文）`
                                );
                                return;
                              }
                              void handleCompressSession(session.id);
                            }}
                            disabled={compressingId === session.id}
                            className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono whitespace-nowrap border-l border-zinc-700/60 transition-colors ${
                              pending >= 10
                                ? "text-amber-400 hover:text-amber-300 hover:bg-zinc-800/60"
                                : "text-zinc-500 cursor-help"
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                            title="把较早的对话总结进长期记忆（原始消息保留，不会删记录）"
                          >
                            {compressingId === session.id ? "整理中..." : "整理记忆"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            )}

            {activeTab === "logs" && <RuntimeLogPanel />}

          </div>
        </div>
      </div>

      {toast && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[268px] z-[60] px-4 py-2 bg-[#8C4F14]/90 border border-[#D18B24] rounded-lg text-sm font-mono text-[#F2B03A] text-center animate-pulse shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
