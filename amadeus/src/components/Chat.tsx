"use client";

import { useState, useRef, useEffect } from "react";
import Settings, { loadModelConfig, ModelConfig } from "./Settings";
import { loadPersonality } from "@/lib/personality";
import { extractMemories, MemoryEntry } from "@/lib/memory";
import { getProactiveMessage } from "@/lib/proactive";
import { getActiveSession, updateSession, ensureDefaultSession, Session } from "@/lib/sessions";
import {
  loadTTSConfig,
  synthesizeSpeech,
  playAudio,
  ensureVoiceSample,
  TTSConfig,
} from "@/lib/tts";
import Live2D from "./Live2D";
import SpritePlayer from "./SpritePlayer";
import getCaretCoordinates from "textarea-caret";
import { parseMessage, getTTSText } from "@/lib/message-parser";
import { dispatchEmotion } from "@/lib/emotion";

interface Message {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}

// 支持图片的多模态模型
const MULTIMODAL_MODELS = ["mimo-v2.5", "gpt-4o", "gpt-4-turbo", "claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"];

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState(loadModelConfig);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(loadTTSConfig);
  const [playingMessageIndex, setPlayingMessageIndex] = useState<number | null>(null);
  const [bgmEnabled, setBgmEnabled] = useState(true);
  // Live2D 立绘尺寸 + 背景图缩放：跟随窗口高度同步缩放（基准 900 高）
  const [liveSize, setLiveSize] = useState({ width: 500, height: 900 });
  const [scale, setScale] = useState(1);
  const pendingReplyRef = useRef(false);
  // 流式输出标志：LLM 逐字返回期间为 true，用来压制 TTS/情绪/session 保存等 effect
  // 避免每收到一个 chunk 就触发一次（会反复播 TTS / 反复写 session）
  const streamingRef = useRef(false);
  // 主动消息定时器需要读取最新的 messages/loading，用 ref 避免 useEffect 空依赖导致的闭包陷阱
  const messagesRef = useRef<Message[]>([]);
  const loadingRef = useRef(false);
  const memoriesRef = useRef<MemoryEntry[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // 窗口缩放时同步更新 Live2D 尺寸 + 背景图 scale（基准 900 高）
  useEffect(() => {
    const update = () => {
      const h = window.innerHeight;
      setLiveSize({ width: h * (500 / 900), height: h });
      setScale(h / 900);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // 加载 BGM 设置（客户端）
  useEffect(() => {
    const saved = localStorage.getItem("amadeus_bgm_enabled");
    if (saved !== null) setBgmEnabled(saved === "true");
  }, []);
  // bgmEnabled 变化或切换会话时控制 audio：开启→从头播放，关闭→暂停并归零
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (bgmEnabled) {
      audio.currentTime = 0;
      audio.play().catch(() => { /* 浏览器自动播放策略拦截，忽略 */ });
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [bgmEnabled, activeSession?.id]);
  // 监听 Settings 面板的实时变更通知：模型/TTS/BGM 配置改了立即重载
  useEffect(() => {
    const handleSettingsChange = () => {
      setConfig(loadModelConfig());
      setTTSConfig(loadTTSConfig());
      const saved = localStorage.getItem("amadeus_bgm_enabled");
      setBgmEnabled(saved !== null ? saved === "true" : true);
    };
    window.addEventListener("amadeus-settings-change", handleSettingsChange);
    return () => window.removeEventListener("amadeus-settings-change", handleSettingsChange);
  }, []);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    const session = ensureDefaultSession();
    setActiveSession(session);
    setMessages(session.messages);
    setMemories(session.memories);
    setConfig(loadModelConfig());
    // 首次使用时自动填充默认音色样本（红莉栖）
    ensureVoiceSample(loadTTSConfig()).then(setTTSConfig);
  }, []);

  const updateCursorPosition = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = textareaRef.current.selectionStart || textareaRef.current.value.length;
      const coords = getCaretCoordinates(textareaRef.current, pos);
      setCursorPos({ x: coords.left, y: coords.top - textareaRef.current.scrollTop });
    });
  };

  useEffect(() => {
    // 页面加载后延迟更新光标位置
    const timer = setTimeout(() => {
      updateCursorPosition();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // 窗口尺寸变化时同步光标装饰位置（如旋转光环）
  // 文字居中布局下，光标 x 会随容器宽度变化而移动，不监听会导致装饰停在旧位置
  useEffect(() => {
    const handleResize = () => updateCursorPosition();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 消息滚动到底部：只在消息数增加时触发（避免 Settings 关闭重载 session 导致误触发）
  // 用容器内 scrollTop 代替 scrollIntoView，防止滚动外溢到 body 导致布局错位
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const el = messagesScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // 情绪驱动：文字回复到达时触发表情，保持到 TTS 播放结束
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "assistant") return;
    // 流式逐字输出期间不触发情绪（文本不完整，标签可能解析错）；流结束最后一次更新时自然触发
    if (streamingRef.current) return;
    dispatchEmotion(lastMessage.content);
  }, [messages]);

  // Auto-play TTS only for the reply that just came in
  useEffect(() => {
    if (messages.length === 0) return;
    if (!ttsConfig.enabled) {
      console.log("[TTS-Trigger] 跳过：ttsConfig.enabled = false");
      return;
    }
    if (!ttsConfig.autoPlay) {
      console.log("[TTS-Trigger] 跳过：ttsConfig.autoPlay = false");
      return;
    }
    if (playingMessageIndex !== null) {
      console.log("[TTS-Trigger] 跳过：正在播放中，index =", playingMessageIndex);
      return;
    }
    if (!pendingReplyRef.current) {
      console.log("[TTS-Trigger] 跳过：pendingReplyRef = false（非用户发消息触发的回复，如主动消息不自动播 TTS）");
      return;
    }
    // 流式逐字输出期间不播 TTS（文本不完整）；流结束最后一次更新时 streamingRef 已 false，自然触发
    if (streamingRef.current) {
      console.log("[TTS-Trigger] 跳过：LLM 流式输出中");
      return;
    }

    const lastIdx = messages.length - 1;
    const lastMessage = messages[lastIdx];
    if (lastMessage.role !== "assistant") {
      console.log("[TTS-Trigger] 跳过：最后一条不是 assistant");
      return;
    }

    pendingReplyRef.current = false;
    const playTTS = async () => {
      setPlayingMessageIndex(lastIdx);
      const ttsText = getTTSText(lastMessage.content);
      console.log("[TTS-Trigger] 提取的 TTS 文本:", ttsText.slice(0, 60), "（长度:", ttsText.length, "）");
      if (!ttsText) {
        console.warn("[TTS-Trigger] TTS 文本为空，跳过合成");
        setPlayingMessageIndex(null);
        return;
      }
      const audio = await synthesizeSpeech(ttsText, ttsConfig);
      if (audio) {
        try {
          await playAudio(audio);
        } catch (err) {
          console.error("[TTS-Trigger] playAudio 失败:", err);
        }
      } else {
        console.warn("[TTS-Trigger] synthesizeSpeech 返回 null，无音频可播放");
      }
      setPlayingMessageIndex(null);
      window.dispatchEvent(new CustomEvent("amadeus-emotion", { detail: { emotion: "neutral", intensity: 0, duration: 0 } }));
    };
    playTTS();
  }, [messages, ttsConfig, playingMessageIndex]);

  useEffect(() => {
    // 流式逐字输出期间频繁写 session 会卡 IO，跳过；流结束最后一次更新时自然保存
    if (streamingRef.current) return;
    if (messages.length > 0 && activeSession) {
      updateSession(activeSession.id, { messages, memories });
    }
  }, [messages, memories, activeSession]);

  useEffect(() => {
    const handleStorage = () => {
      setConfig(loadModelConfig());
      setTTSConfig(loadTTSConfig());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // 主动发消息逻辑
  useEffect(() => {
    const lastActiveKey = "amadeus_last_active";

    const checkAndSendProactive = () => {
      const currentConfig = loadModelConfig();
      if (!currentConfig.apiKey) return;
      // 读 ref 而不是直接读 state，确保拿到最新值
      if (loadingRef.current) return;

      const lastActive = parseInt(localStorage.getItem(lastActiveKey) || "0");
      const now = Date.now();
      const hoursSinceActive = (now - lastActive) / (1000 * 60 * 60);
      if (hoursSinceActive < 1) return;

      if (Math.random() < 0.15) {
        const msg = getProactiveMessage({
          hour: new Date().getHours(),
          lastActiveTime: lastActive,
          memories: memoriesRef.current,
          recentMessages: messagesRef.current.slice(-5),
        });
        if (msg) {
          setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
        }
      }
    };

    // 初始检查
    checkAndSendProactive();

    // 每5分钟检查一次
    const interval = setInterval(checkAndSendProactive, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setImagePreview(result);
      // 转换为 base64（去掉 data:image/xxx;base64, 前缀）
      const base64 = result.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const sendMessage = async () => {
    if (!input.trim() && !imagePreview) return;

    localStorage.setItem("amadeus_last_active", Date.now().toString());

    const currentConfig = loadModelConfig();
    if (!currentConfig.apiKey) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "请先点击右上角齿轮设置 API Key" },
      ]);
      return;
    }

    const messageToSend = input.trim();
    const userMessage: Message = { role: "user", content: messageToSend, imageUrl: imagePreview || undefined };
    setMessages((prev) => [...prev, userMessage]);
    const imageToSend = imageBase64;
    setInput("");
    setTimeout(updateCursorPosition, 0);
    setImagePreview(null);
    setImageBase64(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setLoading(true);
    pendingReplyRef.current = true;

    try {
      // 截断历史：只发最近 10 条给 LLM，控制 input token 数
      // 双语 history 每条很长（中文+===+日语+emotion），10 条约覆盖最近 5 轮对话
      const MAX_HISTORY = 10;
      const recentMessages = messages.length > MAX_HISTORY
        ? messages.slice(-MAX_HISTORY)
        : messages;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageToSend,
          image: imageToSend,
          personality: loadPersonality(),
          history: recentMessages.map((m) => {
            if (m.imageUrl) {
              return {
                role: m.role,
                content: [
                  { type: "text", text: m.content },
                  { type: "image_url", image_url: { url: m.imageUrl } },
                ],
              };
            }
            return { role: m.role, content: m.content };
          }),
          memories: memories.map((m) => ({ content: m.content, type: m.type })),
          ...currentConfig,
        }),
      });

      // 非 200：route 返回 JSON 错误
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({ error: "请求失败" }));
        setLoading(false);
        pendingReplyRef.current = false;
        setMessages((prev) => [...prev, { role: "assistant", content: `错误: ${errData.error}` }]);
        return;
      }

      // 流式读取 SSE：先插一条空 assistant 消息，逐块 append
      // streamingRef=true 期间，TTS/情绪/session 保存 effect 全部跳过
      streamingRef.current = true;
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullReply = "";
      let firstChunk = true;

      const appendDelta = (delta: string) => {
        fullReply += delta;
        if (firstChunk) {
          firstChunk = false;
          setLoading(false); // 首字到达，关掉 ring 动画
        }
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: fullReply };
          }
          return copy;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 事件以空行分隔，每个事件内是 data: xxx
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.content) appendDelta(parsed.content);
          } catch { /* 忽略 */ }
        }
      }

      // 流结束。先关 streamingRef，再触发最后一次 setMessages，
      // 这样 TTS/情绪/session 保存 effect 在最后一次更新时会正常执行（streamingRef 已 false）
      streamingRef.current = false;

      if (!fullReply) {
        pendingReplyRef.current = false;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: "无回复" };
          }
          return copy;
        });
        return;
      }

      // 确保最后一次完整内容写入（触发 TTS/情绪/session effect）
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: fullReply };
        }
        return copy;
      });

      // 提取新记忆（异步，不阻塞 TTS 和 UI）
      // 只取最近 10 条对话做提取，避免又发一个超长请求
      const replyZh = parseMessage(fullReply).zh;
      const recentForMemory = [...messages.slice(-10), { role: "user" as const, content: messageToSend }, { role: "assistant" as const, content: replyZh }];
      extractMemories(recentForMemory, currentConfig).then((newMemories) => {
        if (newMemories.length > 0 && activeSession) {
          setMemories((prev) => {
            const updatedMemories = [
              ...prev,
              ...newMemories.map((content) => ({
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                content,
                timestamp: Date.now(),
                type: "fact" as const,
              })),
            ];
            if (activeSession) updateSession(activeSession.id, { memories: updatedMemories });
            return updatedMemories;
          });
        }
      }).catch(() => { /* 记忆提取失败不影响主流程 */ });
    } catch {
      streamingRef.current = false;
      pendingReplyRef.current = false;
      setMessages((prev) => [...prev, { role: "assistant", content: "通信中断..." }]);
      setLoading(false);
    }
  };

  return (
    <div className="relative h-screen w-screen text-white" style={{ backgroundImage: 'url(/bg.png)', backgroundSize: `${1920 * scale}px ${1080 * scale}px`, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundColor: '#000', overflow: 'hidden' }}>
      {/* 背景音乐：循环播放，切换会话或开关 BGM 时从头开始 */}
      <audio
        ref={(el) => { audioRef.current = el; }}
        key={`bgm-${activeSession?.id ?? "init"}`}
        src="/login.mp3"
        autoPlay
        loop
      />

      {/* 立绘全屏背景 */}
      <div className="absolute inset-0 flex items-end justify-center" style={{ paddingBottom: '0px' }}>
        <Live2D modelPath="/live2d/kurisu/amadeusV1.model3.json" width={liveSize.width} height={liveSize.height} />
      </div>

      <header className="absolute top-0 left-0 right-0 p-4 flex items-center" style={{ zIndex: 30 }}>
        <SpritePlayer
          src="/sprite_logo.png"
          rows={6}
          columns={7}
          fps={20}
          totalFrames={38}
          width={80}
          height={80}
          displayWidth={200}
          displayHeight={200}
          loop={1}
          key={`logo-${activeSession?.id ?? "init"}`}
          style={{ marginLeft: '20px' }}
        />
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-zinc-400 hover:text-white transition-colors p-2 absolute right-4 top-4"
          title="设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </header>

      {/* 聊天面板 - 消息+输入合并 */}
      <div
        className="absolute left-0 right-0 flex flex-col overflow-hidden"
        style={{
          bottom: 0,
          height: '280px',
          zIndex: 20,
          backgroundImage: 'url(/meswin.png)',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
          backgroundPosition: 'left bottom',
        }}
      >
        {/* 顶部留白 */}
        <div style={{ height: '20px', flexShrink: 0 }} />

        {/* 消息滚动区 */}
        <div ref={messagesScrollRef} className="overflow-y-auto px-6 pb-2 space-y-3 custom-scrollbar" style={{ flex: '1 1 0', minHeight: 0 }}>
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-zinc-500 pointer-events-none">
              <p className="font-mono text-sm">输入消息开始对话...</p>
            </div>
          )}
          {messages.map((msg, i) => {
            // 面板显示中文部分（红莉栖语音说日语，但用户看中文）
            const displayContent = msg.role === "assistant"
              ? parseMessage(msg.content).zh
              : msg.content;
            return (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] px-4 py-1 font-mono text-sm text-zinc-100">
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="图片" className="max-w-[200px] max-h-[150px] object-cover rounded-lg mb-2" />
                )}
                {displayContent}
              </div>
            </div>
            );
          })}
          {loading && (
            <div className="flex justify-start items-center gap-2">
              <SpritePlayer
                src="/ring.png"
                rows={12}
                columns={5}
                fps={40}
                width={44}
                height={44}
                totalFrames={60}
                loop={0}
                displayWidth={30}
                displayHeight={30}
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div className="relative flex flex-col justify-end" style={{ height: '70px', paddingBottom: '20px' }}>
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            onInput={() => updateCursorPosition()}
            onFocus={() => updateCursorPosition()}
            onClick={() => updateCursorPosition()}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              className="w-full bg-transparent text-zinc-100 font-mono resize-none outline-none text-center"
              style={{
                fontSize: '1.1rem',
                textShadow: '1px 1px 3px #000, 0 0 1px #fff',
                padding: '0 14vw',
                lineHeight: '1.6',
                letterSpacing: '0.05em',
                scrollbarWidth: 'none',
                maxHeight: '100px',
              }}
            />
            <SpritePlayer
              src="/ring.png"
              rows={12}
              columns={5}
              fps={40}
              width={44}
              height={44}
              totalFrames={60}
              loop={0}
              className="absolute pointer-events-none"
              displayWidth={30}
              displayHeight={30}
              style={{ left: `${cursorPos.x + 8}px`, top: `${cursorPos.y}px` }}
            />
          </div>
        </div>
      </div>

      <Settings open={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        // 重新加载活跃会话（可能在设置中新建/切换了会话）
        const session = getActiveSession();
        if (session) {
          const isSessionSwitch = session.id !== activeSession?.id;
          setActiveSession(session);
          setMessages(session.messages);
          setMemories(session.memories);
          // 仅新建会话时播放问候语语音（只有一条 assistant 消息 = 刚创建的会话）
          if (isSessionSwitch && session.messages.length === 1 && session.messages[0].role === "assistant") {
            const latestTTS = loadTTSConfig();
            if (latestTTS.enabled && latestTTS.autoPlay) {
              const ttsText = getTTSText(session.messages[0].content);
              if (ttsText) {
                synthesizeSpeech(ttsText, latestTTS).then(audio => {
                  if (audio) playAudio(audio);
                });
              }
            }
          }
        }
        setConfig(loadModelConfig());
        setTTSConfig(loadTTSConfig());
        setBgmEnabled(localStorage.getItem("amadeus_bgm_enabled") !== "false");
      }} onSave={() => {
        setConfig(loadModelConfig());
        setTTSConfig(loadTTSConfig());
      }} />
    </div>
  );
}
