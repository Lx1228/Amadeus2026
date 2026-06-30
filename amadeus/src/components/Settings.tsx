"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadSessions, createSession, deleteSession, renameSession, getActiveSession, loadActiveSessionId, saveActiveSessionId, Session, compressSessionMessages, COMPRESS_THRESHOLD } from "@/lib/sessions";
import {
  loadTTSConfig, saveTTSConfig, TTSConfig,
  loadTTSProvider, saveTTSProvider, TTSProvider,
  loadAliyunAPIKey, saveAliyunAPIKey,
  loadMiniMaxAPIKey, saveMiniMaxAPIKey,
  loadAliyunVoiceId, saveAliyunVoiceId,
  loadMiniMaxVoiceId, saveMiniMaxVoiceId,
  loadTTSEngine, saveTTSEngine, TTSEngine,
  loadCustomTTS, saveCustomTTS,
  cloneKurisuVoice, isVoiceCloned, setVoiceCloned, clearVoiceCloned, loadClonedVoice,
} from "@/lib/tts";
import { setSessionLoggedIn } from "@/lib/auth";

export interface ModelConfig {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
}

const PROVIDERS: Record<string, { name: string; endpoints: string[]; models: string[] }> = {
  xiaomi: {
    name: "小米 MiMo",
    endpoints: [
      "https://api.xiaomimimo.com/v1",
      "https://token-plan-cn.xiaomimimo.com/v1",
    ],
    models: [
      "mimo-v2.5",
      "mimo-v2.5-pro",
    ],
  },
  deepseek: {
    name: "DeepSeek",
    endpoints: ["https://api.deepseek.com/v1"],
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  custom: {
    name: "自定义",
    endpoints: [],
    models: [],
  },
};

const STORAGE_KEY = "amadeus_model_config";

export function loadModelConfig(): ModelConfig {
  if (typeof window === "undefined") {
    return { provider: "xiaomi", endpoint: PROVIDERS.xiaomi.endpoints[0], apiKey: "", model: "mimo-v2.5-pro" };
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : { provider: "xiaomi", endpoint: PROVIDERS.xiaomi.endpoints[0], apiKey: "", model: "mimo-v2.5-pro" };
}

export function saveModelConfig(config: ModelConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
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
  { id: "general", label: "通用设置" },
];

export default function Settings({ open, onClose, onSave }: SettingsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("chat-model");
  const [config, setConfig] = useState<ModelConfig>(loadModelConfig);
  const [showKey, setShowKey] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [compressingId, setCompressingId] = useState<string | null>(null);
  const [showNewSessionInput, setShowNewSessionInput] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(loadTTSConfig);
  const [aliyunKey, setAliyunKey] = useState("");
  const [minimaxKey, setMiniMaxKey] = useState("");
  const [aliyunVoiceId, setAliyunVoiceId] = useState("");
  const [minimaxVoiceId, setMiniMaxVoiceId] = useState("");
  const [ttsProvider, setTTSProvider] = useState<TTSProvider>(loadTTSProvider);
  const [ttsEngine, setTTSEngine] = useState<TTSEngine>(loadTTSEngine);
  const [customTTS, setCustomTTS] = useState(loadCustomTTS);
  const [showTTSKeys, setShowTTSKeys] = useState<{ aliyun: boolean; minimax: boolean; custom: boolean }>({
    aliyun: false,
    minimax: false,
    custom: false,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [voiceCloned, setVoiceClonedState] = useState(false);
  const [bgmEnabled, setBgmEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("amadeus_bgm_enabled");
    return saved !== null ? saved === "true" : true;
  });

  useEffect(() => {
    setConfig(loadModelConfig());
    setSessions(loadSessions());
    setActiveSessionId(loadActiveSessionId());
    setTTSConfig(loadTTSConfig());
    setAliyunKey(loadAliyunAPIKey());
    setMiniMaxKey(loadMiniMaxAPIKey());
    setAliyunVoiceId(loadAliyunVoiceId());
    setMiniMaxVoiceId(loadMiniMaxVoiceId());
    setTTSProvider(loadTTSProvider());
    setTTSEngine(loadTTSEngine());
    setCustomTTS(loadCustomTTS());
    setVoiceClonedState(isVoiceCloned());
  }, [open]);

  if (!open) return null;

  const provider = PROVIDERS[config.provider] || PROVIDERS.xiaomi;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // 通知 Chat 组件设置已变更，需实时重载（BGM 立即静音/恢复，模型/TTS 配置即时生效）
  const notifyChange = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("amadeus-settings-change"));
    }
  };

  const handleProviderChange = (value: string) => {
    const p = PROVIDERS[value];
    const updated = { provider: value, endpoint: p.endpoints[0], apiKey: config.apiKey, model: p.models[0] };
    setConfig(updated);
    saveModelConfig(updated);
    notifyChange();
    showToast(`已切换到 ${p.name}`);
  };

  const handleNewSession = () => {
    if (newSessionName.trim()) {
      createSession(newSessionName.trim());
      setNewSessionName("");
      setShowNewSessionInput(false);
      setSessions(loadSessions());
      setActiveSessionId(loadActiveSessionId());
      showToast("新会话已创建");
    }
  };

  const handleDeleteSession = (id: string) => {
    deleteSession(id);
    setDeleteConfirmId(null);
    setSessions(loadSessions());
    setActiveSessionId(loadActiveSessionId());
    showToast("会话已删除");
  };

  const handleRenameSession = (id: string) => {
    if (editingName.trim()) {
      renameSession(id, editingName.trim());
      setEditingSessionId(null);
      setEditingName("");
      setSessions(loadSessions());
      showToast("会话已重命名");
    }
  };

  const handleSwitchSession = (id: string) => {
    saveActiveSessionId(id);
    setActiveSessionId(id);
    showToast("已切换会话");
  };

  const handleCompressSession = async (id: string) => {
    setCompressingId(id);
    try {
      const cfg = loadModelConfig();
      const result = await compressSessionMessages(id, cfg);
      if (result === -1) {
        showToast(`消息数未达 ${COMPRESS_THRESHOLD} 条，无需压缩`);
      } else if (result === -2) {
        showToast("压缩失败，请检查 API Key 或网络");
      } else {
        setSessions(loadSessions());
        showToast(`已压缩，保留 ${result} 条消息`);
      }
    } catch {
      showToast("压缩失败");
    } finally {
      setCompressingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl h-[500px] flex overflow-hidden"
      >
        {/* 左侧菜单 */}
        <div className="w-48 bg-zinc-950 border-r border-zinc-700 p-4">
          <h2 className="text-sm font-mono text-zinc-500 mb-4 px-2">设置</h2>
          <nav className="space-y-1">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
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
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <h2 className="text-lg font-mono text-[#F2B03A]">
              {activeTab === "chat-model" ? "Chat模型" : activeTab === "tts" ? "语音合成" : activeTab === "memory" ? "会话管理" : "通用设置"}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // 用 location.replace 强制整页刷新到登录页，绕过 React 状态更新 + 组件卸载的开销
                  setSessionLoggedIn(false);
                  window.location.replace("/login");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/40 hover:bg-red-900/70 border border-red-700 rounded-lg text-xs font-mono text-red-300 hover:text-red-200 transition-colors"
                title="退出当前账号，返回登录界面"
              >
                退出登录
              </button>
              <button onClick={onClose} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-xs font-mono text-zinc-300 hover:text-white transition-colors">
                <span>←</span> 返回聊天
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
                  {config.provider === "custom" ? (
                    <input
                      type="text"
                      value={config.endpoint}
                      onChange={(e) => {
                        const updated = { ...config, endpoint: e.target.value };
                        setConfig(updated);
                        saveModelConfig(updated);
                        notifyChange();
                      }}
                      placeholder="https://api.example.com/v1"
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                    />
                  ) : (
                    <select
                      value={config.endpoint}
                      onChange={(e) => {
                        setConfig({ ...config, endpoint: e.target.value });
                        saveModelConfig({ ...config, endpoint: e.target.value });
                        notifyChange();
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
                          // 只更新本地 state，不自动保存——防浏览器覆盖
                          setConfig({ ...config, apiKey: e.target.value });
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
                        notifyChange();
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
                  {config.provider === "custom" ? (
                    <input
                      type="text"
                      value={config.model}
                      onChange={(e) => {
                        const updated = { ...config, model: e.target.value };
                        setConfig(updated);
                        saveModelConfig(updated);
                        notifyChange();
                      }}
                      placeholder="gpt-4o / claude-3-opus / ..."
                      className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                    />
                  ) : (
                    <select
                      value={config.model}
                      onChange={(e) => {
                        setConfig({ ...config, model: e.target.value });
                        saveModelConfig({ ...config, model: e.target.value });
                        notifyChange();
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
                {/* 启用开关 */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-mono text-zinc-200">启用语音合成</h3>
                  </div>
                  <button
                    onClick={() => {
                      const updated = { ...ttsConfig, enabled: !ttsConfig.enabled };
                      setTTSConfig(updated);
                      saveTTSConfig(updated);
                      notifyChange();
                      showToast(updated.enabled ? "语音合成已开启" : "语音合成已关闭");
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

                {/* TTS 提供商 */}
                <div>
                  <label className="block text-xs text-zinc-400 mb-1 font-mono">TTS 提供商</label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => {
                      const p = e.target.value as TTSProvider;
                      setTTSProvider(p);
                      saveTTSProvider(p);
                      // 切换提供商时自动选择该提供商的第一个引擎
                      if (p === "aliyun") {
                        setTTSEngine("cosyvoice-v3.5-flash");
                        saveTTSEngine("cosyvoice-v3.5-flash");
                      } else if (p === "minimax") {
                        setTTSEngine("speech-2.8-hd");
                        saveTTSEngine("speech-2.8-hd");
                      }
                      notifyChange();
                      showToast(`已切换到 ${p === "aliyun" ? "阿里云百炼" : p === "minimax" ? "MiniMax" : "自定义"}`);
                    }}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white"
                  >
                    <option value="aliyun">阿里云百炼</option>
                    <option value="minimax">MiniMax</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>

                {/* 阿里云百炼 */}
                {ttsProvider === "aliyun" && (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">阿里云 API Key</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showTTSKeys.aliyun ? "text" : "password"}
                            value={aliyunKey}
                            onChange={(e) => setAliyunKey(e.target.value)}
                            autoComplete="off"
                            name="amadeus-aliyun-key"
                            placeholder="sk-xxxxxxxx"
                            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500 pr-16"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTTSKeys((s) => ({ ...s, aliyun: !s.aliyun }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                          >
                            {showTTSKeys.aliyun ? "隐藏" : "显示"}
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            const trimmed = aliyunKey.trim();
                            setAliyunKey(trimmed);
                            saveAliyunAPIKey(trimmed);
                            notifyChange();
                            showToast(`阿里云 Key 已保存（${trimmed.length} 字符）`);
                          }}
                          className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm whitespace-nowrap"
                        >
                          保存
                        </button>
                      </div>
                      <p className="text-xs text-zinc-600 mt-1">
                        当前已保存：{loadAliyunAPIKey() ? `sk-***${loadAliyunAPIKey().slice(-4)}（${loadAliyunAPIKey().length} 字符）` : "未配置"}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">TTS 引擎</label>
                      <select
                        value={ttsEngine}
                        onChange={(e) => {
                          const engine = e.target.value as TTSEngine;
                          setTTSEngine(engine);
                          saveTTSEngine(engine);
                          const names: Record<string, string> = {
                            "cosyvoice-v3.5-plus": "CosyVoice v3.5-plus",
                            "cosyvoice-v3.5-flash": "CosyVoice v3.5-flash",
                            "cosyvoice-v3-flash": "CosyVoice v3-flash",
                            "cosyvoice-v3-plus": "CosyVoice v3-plus",
                            "qwen3-tts-vc": "Qwen3-TTS-VC",
                          };
                          notifyChange();
                          showToast(`已切换到 ${names[engine] || engine}`);
                        }}
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white"
                      >
                        <option value="cosyvoice-v3.5-plus">CosyVoice v3.5-plus（最强，指令控制语气）</option>
                        <option value="cosyvoice-v3.5-flash">CosyVoice v3.5-flash（快，指令控制语气）</option>
                        <option value="cosyvoice-v3-flash">CosyVoice v3-flash（指令控制语气）</option>
                        <option value="cosyvoice-v3-plus">CosyVoice v3-plus（默认语气）</option>
                        <option value="qwen3-tts-vc">Qwen3-TTS-VC（千问语音）</option>
                      </select>
                      <p className="text-xs text-zinc-600 mt-1">"指令控制"会根据语境自动调节语气</p>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">一键克隆红莉栖音色</label>
                      <div className="bg-zinc-800/50 border border-[#8C4F14] rounded-lg p-3">
                        <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                          {voiceCloned
                            ? `已克隆，音色名：${loadClonedVoice() || "（未知）"}。引擎已自动切到 Qwen3-TTS-VC。`
                            : "内置红莉栖音色样本，填好上方 API Key 后点下方按钮，自动克隆到你的阿里云账号。无需手动去控制台操作。"}
                        </p>
                        <div className="flex gap-2">
                          <button
                            disabled={cloning || !aliyunKey.trim()}
                            onClick={async () => {
                              const key = aliyunKey.trim();
                              if (!key) { showToast("请先填写并保存阿里云 API Key"); return; }
                              setCloning(true);
                              try {
                                showToast("正在克隆音色，约需 5-15 秒...");
                                const { voice, fallbackMode } = await cloneKurisuVoice(key);
                                setVoiceCloned(voice);
                                setVoiceClonedState(true);
                                // 自动切到 qwen3-tts-vc 引擎（克隆音色只能配合这个引擎）
                                setTTSEngine("qwen3-tts-vc");
                                saveTTSEngine("qwen3-tts-vc");
                                // 清空手填的 voiceId（用克隆的）
                                setAliyunVoiceId("");
                                saveAliyunVoiceId("");
                                notifyChange();
                                showToast(fallbackMode
                                  ? `克隆成功（降级模式）：${voice}。建议换更清晰的样本重试。`
                                  : `克隆成功！音色名：${voice}。引擎已切到 Qwen3-TTS-VC。`);
                              } catch (e) {
                                showToast(`克隆失败：${e instanceof Error ? e.message : "未知错误"}`);
                              } finally {
                                setCloning(false);
                              }
                            }}
                            className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-mono text-sm whitespace-nowrap transition-colors"
                          >
                            {cloning ? "克隆中..." : voiceCloned ? "重新克隆" : "一键克隆"}
                          </button>
                          {voiceCloned && (
                            <button
                              onClick={() => {
                                clearVoiceCloned();
                                setVoiceClonedState(false);
                                showToast("已清除克隆标记，可重新克隆");
                              }}
                              className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg font-mono text-sm whitespace-nowrap"
                            >
                              清除标记
                            </button>
                          )}
                        </div>
                        {voiceCloned && (
                          <p className="text-xs text-[#F2B03A] mt-2">
                            ✓ 已克隆。现在直接去聊天，红莉栖就能说话了。
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">音色 ID（可选）</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={aliyunVoiceId}
                          onChange={(e) => setAliyunVoiceId(e.target.value)}
                          autoComplete="off"
                          placeholder="留空用默认，需自行克隆音色"
                          className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                        />
                        <button
                          onClick={() => {
                            const trimmed = aliyunVoiceId.trim();
                            setAliyunVoiceId(trimmed);
                            saveAliyunVoiceId(trimmed);
                            notifyChange();
                            showToast(trimmed ? "音色 ID 已保存" : "已清空，将使用默认音色");
                          }}
                          className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm whitespace-nowrap"
                        >
                          保存
                        </button>
                      </div>
                      <p className="text-xs text-zinc-600 mt-1">
                        留空用一键克隆的音色。如想用 CosyVoice 引擎（音质更好），需自行到阿里云控制台用 public/voice_sample.mp3 克隆，把得到的 ID 填这里。
                      </p>
                    </div>
                  </>
                )}

                {/* MiniMax */}
                {ttsProvider === "minimax" && (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">MiniMax API Key</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showTTSKeys.minimax ? "text" : "password"}
                            value={minimaxKey}
                            onChange={(e) => setMiniMaxKey(e.target.value)}
                            autoComplete="off"
                            name="amadeus-minimax-key"
                            placeholder="sk-api-xxxxxxxx"
                            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500 pr-16"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTTSKeys((s) => ({ ...s, minimax: !s.minimax }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                          >
                            {showTTSKeys.minimax ? "隐藏" : "显示"}
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            const trimmed = minimaxKey.trim();
                            setMiniMaxKey(trimmed);
                            saveMiniMaxAPIKey(trimmed);
                            notifyChange();
                            showToast(`MiniMax Key 已保存（${trimmed.length} 字符）`);
                          }}
                          className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm whitespace-nowrap"
                        >
                          保存
                        </button>
                      </div>
                      <p className="text-xs text-zinc-600 mt-1">
                        当前已保存：{loadMiniMaxAPIKey() ? `***${loadMiniMaxAPIKey().slice(-4)}（${loadMiniMaxAPIKey().length} 字符）` : "未配置"}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">TTS 引擎</label>
                      <select
                        value={ttsEngine}
                        onChange={(e) => {
                          const engine = e.target.value as TTSEngine;
                          setTTSEngine(engine);
                          saveTTSEngine(engine);
                          notifyChange();
                          showToast(`已切换到 ${engine}`);
                        }}
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white"
                      >
                        <option value="speech-2.8-hd">speech-2.8-hd（最新，情绪渲染融合语气词）</option>
                        <option value="speech-2.8-turbo">speech-2.8-turbo（最新，极致速度）</option>
                        <option value="speech-2.6-hd">speech-2.6-hd（韵律表现出色）</option>
                        <option value="speech-2.6-turbo">speech-2.6-turbo（音质优异，超低时延）</option>
                        <option value="speech-02-hd">speech-02-hd（复刻相似度高）</option>
                        <option value="speech-02-turbo">speech-02-turbo（小语种能力加强）</option>
                      </select>
                      <p className="text-xs text-zinc-600 mt-1">所有模型都支持情绪控制，会根据语境自动调节语气</p>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">音色 ID（可选）</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={minimaxVoiceId}
                          onChange={(e) => setMiniMaxVoiceId(e.target.value)}
                          autoComplete="off"
                          placeholder="留空用默认 kurisu-amadeus"
                          className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                        />
                        <button
                          onClick={() => {
                            const trimmed = minimaxVoiceId.trim();
                            setMiniMaxVoiceId(trimmed);
                            saveMiniMaxVoiceId(trimmed);
                            notifyChange();
                            showToast(trimmed ? "音色 ID 已保存" : "已清空，将使用默认音色");
                          }}
                          className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm whitespace-nowrap"
                        >
                          保存
                        </button>
                      </div>
                      <p className="text-xs text-zinc-600 mt-1">
                        在 MiniMax 控制台「声音复刻」复刻音色后，把得到的音色 ID 填这里。
                      </p>
                    </div>
                  </>
                )}

                {/* 自定义 */}
                {ttsProvider === "custom" && (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">接口协议</label>
                      <input
                        type="text"
                        value={customTTS.endpoint}
                        onChange={(e) => {
                          const updated = { ...customTTS, endpoint: e.target.value };
                          setCustomTTS(updated);
                          saveCustomTTS(updated);
                          notifyChange();
                        }}
                        placeholder="https://api.example.com/v1"
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">模型</label>
                      <input
                        type="text"
                        value={customTTS.model}
                        onChange={(e) => {
                          const updated = { ...customTTS, model: e.target.value };
                          setCustomTTS(updated);
                          saveCustomTTS(updated);
                          notifyChange();
                        }}
                        placeholder="model-name"
                        className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1 font-mono">API Key</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showTTSKeys.custom ? "text" : "password"}
                            value={customTTS.apiKey}
                            onChange={(e) => {
                              // 只更新本地 state，不自动保存——防浏览器覆盖
                              setCustomTTS({ ...customTTS, apiKey: e.target.value });
                            }}
                            autoComplete="off"
                            name="amadeus-custom-key"
                            placeholder="your-api-key"
                            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500 pr-16"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTTSKeys((s) => ({ ...s, custom: !s.custom }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                          >
                            {showTTSKeys.custom ? "隐藏" : "显示"}
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            const trimmed = customTTS.apiKey.trim();
                            const updated = { ...customTTS, apiKey: trimmed };
                            setCustomTTS(updated);
                            saveCustomTTS(updated);
                            notifyChange();
                            showToast(`自定义 Key 已保存（${trimmed.length} 字符）`);
                          }}
                          className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm whitespace-nowrap"
                        >
                          保存
                        </button>
                      </div>
                      <p className="text-xs text-zinc-600 mt-1">
                        当前已保存：{loadCustomTTS().apiKey ? `***${loadCustomTTS().apiKey.slice(-4)}（${loadCustomTTS().apiKey.length} 字符）` : "未配置"}
                      </p>
                    </div>
                  </>
                )}
                {/* TTS 设置保存按钮 */}
                <div className="flex justify-end pt-4 border-t border-zinc-800 gap-2">
                  <button
                    className="px-4 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm"
                    onClick={() => {
                      // trim 掉复制时可能带入的空格/换行符
                      const trimmedAliyun = aliyunKey.trim();
                      const trimmedMinimax = minimaxKey.trim();
                      const trimmedCustom = { ...customTTS, apiKey: customTTS.apiKey.trim() };
                      setAliyunKey(trimmedAliyun);
                      setMiniMaxKey(trimmedMinimax);
                      setCustomTTS(trimmedCustom);
                      // 显式保存所有 TTS 配置
                      saveTTSConfig(ttsConfig);
                      saveTTSProvider(ttsProvider);
                      saveTTSEngine(ttsEngine);
                      saveAliyunAPIKey(trimmedAliyun);
                      saveMiniMaxAPIKey(trimmedMinimax);
                      saveCustomTTS(trimmedCustom);
                      notifyChange();
                      const keyForMask = trimmedAliyun || trimmedMinimax || trimmedCustom.apiKey || "";
                      const maskedKey = keyForMask
                        ? `***${keyForMask.slice(-4)}`
                        : "未填写";
                      showToast(`TTS 设置已保存（Key: ${maskedKey}，共 ${keyForMask.length} 字符）`);
                    }}
                  >
                    保存 TTS 设置
                  </button>
                </div>
              </div>
            )}

            {activeTab === "memory" && (
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <button
                    onClick={() => setShowNewSessionInput(true)}
                    className="text-xs text-[#F2B03A] hover:text-[#F2B03A] font-mono"
                  >
                    + 新开会话
                  </button>
                </div>

                {showNewSessionInput && (
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={newSessionName}
                      onChange={(e) => setNewSessionName(e.target.value)}
                      placeholder="会话名称..."
                      className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-zinc-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleNewSession();
                        if (e.key === "Escape") {
                          setShowNewSessionInput(false);
                          setNewSessionName("");
                        }
                      }}
                    />
                    <button
                      onClick={handleNewSession}
                      className="px-3 py-2 bg-[#D18B24] hover:bg-[#E0551E] text-white rounded-lg font-mono text-sm"
                    >
                      创建
                    </button>
                    <button
                      onClick={() => { setShowNewSessionInput(false); setNewSessionName(""); }}
                      className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-mono text-sm"
                    >
                      取消
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                  {sessions.map((session, index) => (
                    <div
                      key={session.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        session.id === activeSessionId
                          ? "bg-[#8C4F14]/30 border-[#8C4F14]"
                          : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
                      }`}
                      onClick={() => handleSwitchSession(session.id)}
                    >
                      <div className="flex items-center justify-between">
                        {editingSessionId === session.id ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="flex-1 bg-zinc-700 border border-zinc-500 rounded px-2 py-1 text-sm font-mono text-white"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameSession(session.id);
                              if (e.key === "Escape") { setEditingSessionId(null); setEditingName(""); }
                            }}
                            onBlur={() => handleRenameSession(session.id)}
                          />
                        ) : (
                          <span className="text-sm font-mono text-zinc-200 truncate">{session.name}</span>
                        )}
                        <div className="flex gap-1 ml-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingSessionId(session.id); setEditingName(session.name); }}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-white transition-colors"
                            title="重命名"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6h11.25" />
                            </svg>
                          </button>
                          {index !== 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(session.id); }}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors"
                              title="删除"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-zinc-500">
                          {session.messages.length} 条消息
                          {session.messages.length > COMPRESS_THRESHOLD && (
                            <span className="text-amber-500 ml-1">（建议压缩）</span>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          {session.messages.length > COMPRESS_THRESHOLD && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCompressSession(session.id); }}
                              disabled={compressingId === session.id}
                              className="text-xs text-amber-400 hover:text-amber-300 font-mono disabled:opacity-50 disabled:cursor-wait"
                              title={`消息超过 ${COMPRESS_THRESHOLD} 条，点击压缩上下文`}
                            >
                              {compressingId === session.id ? "压缩中..." : "压缩上下文"}
                            </button>
                          )}
                          {session.id === activeSessionId && (
                            <span className="text-xs font-mono text-[#F2B03A]">已选择</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {deleteConfirmId && (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setDeleteConfirmId(null)}>
                    <div className="bg-zinc-800 border border-zinc-600 rounded-xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
                      <p className="text-sm font-mono text-zinc-200 mb-4">
                        确定要删除这个会话吗？<br />
                        <span className="text-red-400">删除后该会话的所有记忆存档将被清空，此操作不可撤销。</span>
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-2 rounded-lg font-mono text-sm"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => handleDeleteSession(deleteConfirmId)}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg font-mono text-sm"
                        >
                          确认删除
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "general" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-mono text-zinc-200">背景音乐</h3>
                  </div>
                  <button
                    onClick={() => {
                      const next = !bgmEnabled;
                      setBgmEnabled(next);
                      localStorage.setItem("amadeus_bgm_enabled", String(next));
                      notifyChange();
                      showToast(next ? "背景音乐已开启" : "背景音乐已关闭");
                    }}
                    className={`w-12 h-6 rounded-full transition-colors relative ${
                      bgmEnabled ? "bg-[#D18B24]" : "bg-zinc-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                        bgmEnabled ? "translate-x-6" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 translate-y-[268px] z-[60] px-4 py-2 bg-[#8C4F14]/90 border border-[#D18B24] rounded-lg text-sm font-mono text-[#F2B03A] text-center animate-pulse shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
