"use client";

import { useState, useRef, useEffect } from "react";
import Settings from "./Settings";
import { loadModelConfig } from "@/lib/model-config";
import { extractMemories, MemoryEntry } from "@/lib/memory";
import { getProactiveMessage } from "@/lib/proactive";
import { getActiveSession, updateSession, ensureDefaultSession, restoreSessionsFromBackup, summarizeOldMessages, Session } from "@/lib/sessions";
import {
  loadTTSConfig,
  saveTTSConfig,
  synthesizeSpeech,
  synthesizeSpeechStream,
  playAudio,
  TTSConfig,
} from "@/lib/tts";
import { StreamTTSQueue } from "@/lib/stream-tts-queue";
import Live2D from "./Live2D";
import SpritePlayer from "./SpritePlayer";
import { useStageMetrics } from "./ViewportScaler";
import getCaretCoordinates from "textarea-caret";
import { parseMessage, getTTSText } from "@/lib/message-parser";
import { dispatchEmotion } from "@/lib/emotion";
import { getSessionCharacterId } from "@/lib/auth";
import { getCharacterById } from "@/lib/characters";
import { compressImage } from "@/lib/image-compress";
import { log } from "@/lib/debug-log";
import { appLog, appErr } from "@/lib/app-log";

interface Message {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
}

// 图片消息直接用 image_url 格式发送（mimo-v2.6 等全模态模型均支持）

export default function Chat() {
  // 当前登录角色（组件挂载时读取一次，本会话不变）
  const character = getCharacterById(getSessionCharacterId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [input, setInput] = useState("");
  // 文档附件提示条（2026-10-25）：拒绝不支持的文件时给一句即时反馈
  const [docHint, setDocHint] = useState("");
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
  // 2026-10-25：本地语音模型安装状态轮询已随本地引擎功能一起删除，
  // 语音合成走云端（CosyVoice），无需预装检测。
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(loadTTSConfig);
  const [playingMessageIndex, setPlayingMessageIndex] = useState<number | null>(null);
  const [bgmEnabled, setBgmEnabled] = useState(true);
  // 加号菜单
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  // 让 body 背景和当前角色背景一致（2026-10-25）
  // 作用：全屏切换时舞台会透明 1~2 帧来隐藏"内容错位"那一帧，
  // 露出同款背景比露出纯黑自然得多。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const bg = character.bgImage;
    if (!bg) return;
    document.body.style.backgroundImage = `url(${bg})`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundRepeat = "no-repeat";
  }, [character.bgImage]);

  // Live2D 立绘尺寸 + 背景图缩放（2026-10-25）
  // 舞台高度不再是常量（ViewportScaler 会按窗口比例自适应，消除黑边），
  // 所以用 useStageMetrics 订阅：只有尺寸真的变化时才重渲染一次。
  // 基准 900 高是立绘美术资源的设计高度。
  // scale 还要传给 Live2D 当 pixelRatio —— 全屏时 canvas 内部要按放大倍数提高
  // 渲染分辨率，否则会被外层 zoom 放大成糊图。
  const stageMetrics = useStageMetrics();
  const pendingReplyRef = useRef(false);
  // 流式输出标志：LLM 逐字返回期间为 true，用来压制 TTS/情绪/session 保存等 effect
  // 避免每收到一个 chunk 就触发一次（会反复播 TTS / 反复写 session）
  const streamingRef = useRef(false);
  // 流式逐句 TTS：LLM 输出期间边生成边合成（2026-10-17，替代"等全文说完才合成"）
  const streamTTSQueueRef = useRef<StreamTTSQueue | null>(null);
  // 本轮回复的 TTS 是否已由流式逐句处理（流结束时 TTS effect 检测到就跳过整条播报）
  const streamedTTSRef = useRef(false);
  // 主动消息定时器需要读取最新的 messages/loading，用 ref 避免 useEffect 空依赖导致的闭包陷阱
  const messagesRef = useRef<Message[]>([]);
  const loadingRef = useRef(false);
  const memoriesRef = useRef<MemoryEntry[]>([]);
  // 防止自动摘要并发触发（摘要要调一次 LLM，不能每轮叠加）
  const summarizingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // 2026-10-25：整体缩放改由 CSS 根字号驱动（layout.tsx 的 html fontSize = 100vw/80），
  // 这里不再监听 resize、也不再自己算立绘/背景尺寸：
  //   - 立绘尺寸交给 CSS（高 100%、宽 400/1280），窗口变化时浏览器直接重排
  //   - 背景图用 backgroundSize: cover，同样由浏览器处理
  //   - 立绘 canvas 的内部渲染分辨率由 Live2D 内部按 ResizeObserver + pixelRatio 自动调整
  // 这样窗口变化时没有任何 JS 参与排布，所以既不会糊也不会闪。
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

  // 2026-10-25：本地语音模型安装状态轮询已删除（本地引擎功能下线）

  // 监听 Settings 面板的实时变更通知：模型/TTS 配置改了立即重载（BGM 开关在主界面，直接改本地 state）
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

  // 语音通话结束后，同步最新会话消息到当前界面
  useEffect(() => {
    const handleSessionUpdated = () => {
      const s = getActiveSession();
      if (s) {
        setMessages(s.messages);
        setMemories(s.memories);
      }
    };
    window.addEventListener("amadeus-session-updated", handleSessionUpdated);
    return () => window.removeEventListener("amadeus-session-updated", handleSessionUpdated);
  }, []);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      // 清 WebView2 缓存后 localStorage 会空——启动时先尝试从服务端文件备份恢复
      const restored = await restoreSessionsFromBackup();
      if (cancelled) return;
      const session = ensureDefaultSession();
      setActiveSession(session);
      setMessages(session.messages);
      setMemories(session.memories);
      setConfig(loadModelConfig());
      setTTSConfig(loadTTSConfig());
      if (restored) {
        console.log("[Chat] 会话已从文件备份恢复（本地缓存曾被清空）");
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
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

  // 2026-10-25：原来这里监听 window resize 重算光标装饰位置。
  // 现在整个界面由 ViewportScaler 按固定 1280×720 舞台缩放，容器宽度永远不变，
  // 这个监听没有意义；而且它每次都会 setState 重渲染整棵树，和缩放容器
  // 形成两条不同步的渲染路径，拖动窗口时画面会"两个尺寸交替闪"。
  // 光标位置改为在输入内容变化时更新（updateCursorPosition 已在别处调用）。

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
      log("[TTS-Trigger] 跳过：ttsConfig.enabled = false");
      return;
    }
    if (!ttsConfig.autoPlay) {
      log("[TTS-Trigger] 跳过：ttsConfig.autoPlay = false");
      return;
    }
    if (playingMessageIndex !== null) {
      log("[TTS-Trigger] 跳过：正在播放中，index =", playingMessageIndex);
      return;
    }
    if (!pendingReplyRef.current) {
      log("[TTS-Trigger] 跳过：pendingReplyRef = false（非用户发消息触发的回复，如主动消息不自动播 TTS）");
      return;
    }
    // 流式逐字输出期间不播 TTS（文本不完整）；流结束最后一次更新时 streamingRef 已 false，自然触发
    if (streamingRef.current) {
      log("[TTS-Trigger] 跳过：LLM 流式输出中");
      return;
    }
    // 流式逐句 TTS 已处理本轮（2026-10-17 边生成边合成）——跳过整条播报，避免重复
    if (streamedTTSRef.current) {
      streamedTTSRef.current = false;
      log("[TTS-Trigger] 跳过：本轮已由流式逐句播报");
      return;
    }

    const lastIdx = messages.length - 1;
    const lastMessage = messages[lastIdx];
    if (lastMessage.role !== "assistant") {
      log("[TTS-Trigger] 跳过：最后一条不是 assistant");
      return;
    }

    pendingReplyRef.current = false;
    const playTTS = async () => {
      setPlayingMessageIndex(lastIdx);
      const ttsText = getTTSText(lastMessage.content);
      log("[TTS-Trigger] 提取的 TTS 文本:", ttsText.slice(0, 60), "（长度:", ttsText.length, "）");
      if (!ttsText) {
        console.warn("[TTS-Trigger] TTS 文本为空，跳过合成");
        setPlayingMessageIndex(null);
        return;
      }
      // 从回复里解析情绪标签（[emotion:smile]），传给 TTS 做语气渲染
      const parsedEmotion = parseMessage(lastMessage.content).emotion ?? "neutral";
      // 流式合成：首段音频到达就开始播，不等整句合成完（2026-10-12）
      // 内部失败会自动降级到 synthesizeSpeech（整体合成），保证一定有声音
      appLog("语音朗读", `开始（${ttsText.length} 字）`);
      const audio = await synthesizeSpeechStream(ttsText, ttsConfig, parsedEmotion);
      if (audio) {
        try {
          await playAudio(audio);
        } catch (err) {
          console.error("[TTS-Trigger] playAudio 失败:", err);
        }
      } else {
        console.warn("[TTS-Trigger] synthesizeSpeechStream 返回 null，无音频可播放");
        appErr("语音朗读", "合成返回空（检查引擎/Key/服务状态）");
      }
      setPlayingMessageIndex(null);
      // 语音播完后恢复中性表情
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

  const handleImageUpload = async (file: File | Blob) => {
    try {
      const compressed = await compressImage(file);
      setImagePreview(compressed.dataUrl);
      setImageBase64(compressed.base64);
    } catch (e) {
      console.error("[ImageUpload] 压缩失败:", e);
    }
  };

  // === 文档附件（2026-10-25）===
  // 用户拍板：只收纯文本类文档（txt/md）+ 图片；Word/PDF 等复杂格式不收；
  // 大小双上限（200KB / 8 万字符）防止把上下文挤满。
  // 文档内容直接以「文件名 + 代码块」的形式拼进输入框，走普通文本消息发送，
  // 小米 mimo / DeepSeek flash 都能读。
  const MAX_DOC_BYTES = 200 * 1024;
  const MAX_DOC_CHARS = 80_000;

  const isTextDoc = (file: File) =>
    /\.(txt|md|markdown)$/i.test(file.name) || file.type === "text/plain";

  const showDocHint = (msg: string) => {
    setDocHint(msg);
    window.setTimeout(() => setDocHint((cur) => (cur === msg ? "" : cur)), 3500);
  };

  const handleDocFile = (file: File) => {
    if (file.size > MAX_DOC_BYTES) {
      appErr("附加文档", `${file.name} ${Math.ceil(file.size / 1024)}KB，超过 200KB 上限`);
      showDocHint(`「${file.name}」超过 200KB 上限，会挤爆上下文，不收哦`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      if (content.length > MAX_DOC_CHARS) {
        appErr("附加文档", `${file.name} 内容 ${content.length} 字符，超过上限`);
        showDocHint("文件内容太长（8 万字符上限），会挤爆上下文，不收哦");
        return;
      }
      setInput(
        (prev) =>
          `${prev}${prev && !prev.endsWith("\n") ? "\n" : ""}\n【文档：${file.name}】\n\`\`\`\n${content}\n\`\`\`\n`
      );
      appLog("附加文档", `${file.name}（${content.length} 字符）`);
      textareaRef.current?.focus();
    };
    reader.onerror = () => appErr("附加文档", `${file.name} 读取失败`);
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) handleImageUpload(file);
    else if (isTextDoc(file)) handleDocFile(file);
    else showDocHint("只支持图片和 txt / md 文本文件，Word、PDF 这些复杂格式不收哦");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) handleImageUpload(file);
    else if (isTextDoc(file)) handleDocFile(file);
    else showDocHint("只支持图片和 txt / md 文本文件，Word、PDF 这些复杂格式不收哦");
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          handleImageUpload(file);
          e.preventDefault();
          break;
        }
      }
    }
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

    appLog(
      "发送消息",
      `${input.trim().length} 字${imagePreview ? " + 图片 1 张" : ""}`
    );

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
    // 图片直接用 data URL（不存硬盘）
    const imageUrlForMsg = imagePreview || undefined;
    const userMessage: Message = { role: "user", content: messageToSend, imageUrl: imageUrlForMsg };
    setMessages((prev) => [...prev, userMessage]);
    const imageToSend = imageBase64; // 发 LLM 的 base64（已有）
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

      // 异步解析历史消息中的图片（现在都是 data URL，直接用）
      const resolvedHistory = recentMessages.map((m) => {
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
      });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageToSend,
          image: imageToSend,
          personality: character.personality,
          history: resolvedHistory,
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

      // 流式逐句 TTS：LLM 输出期间边生成边合成（不等全文说完）
      // 音色/情绪约束见 stream-tts-queue.ts 顶部说明
      streamedTTSRef.current = true;
      const lastIdxNow = messages.length; // 新插入的 assistant 消息 index
      setPlayingMessageIndex(lastIdxNow);
      const ttsQueue = new StreamTTSQueue(ttsConfig, () => {
        // 全部句子播完：恢复中性表情、清播放状态
        setPlayingMessageIndex(null);
        window.dispatchEvent(new CustomEvent("amadeus-emotion", { detail: { emotion: "neutral", intensity: 0, duration: 0 } }));
      });
      streamTTSQueueRef.current = ttsQueue;

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
        ttsQueue.append(delta);
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

      // 流式 TTS 收尾：冲刷剩余缓冲，把最后几句送合成。
      // 播放完成由 onAllDone 回调收尾（清 playingMessageIndex + 恢复 neutral）。
      // 注意：这里不 await——记忆提取和 UI 更新不阻塞播放。
      ttsQueue.finish();
      streamTTSQueueRef.current = null;
      // 本轮回复的 TTS 已全部交给流式队列 → 关闭「待播报」标记。
      // ⚠️ 不清的话 pendingReplyRef 会一直为 true，之后任何 messages 变化
      // （语音通话写入会话、会话同步事件、主动消息）都会让 TTS-Trigger 把
      // 最后一条 assistant 消息再合成再播一遍 —— 2026-10-18 用户实测
      // 「同一句话隔几秒又重复说一声」的根因。
      pendingReplyRef.current = false;

      if (!fullReply) {
        pendingReplyRef.current = false;
        ttsQueue.cancel();
        streamTTSQueueRef.current = null;
        setPlayingMessageIndex(null);
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

      // 自动摘要（2026-10-25）：未摘要的消息攒够 10 条以上就把较旧的部分
      // 总结进长期记忆，让模型"记得远一点"。
      // 关键：不删原始消息，只更新 memories + summarizedUpTo，聊天记录完整保留。
      // summarizeOldMessages 内部会判断攒够没攒够，攒不够直接返回 null，不烧 token。
      if (activeSession && !summarizingRef.current) {
        summarizingRef.current = true;
        summarizeOldMessages(activeSession.id, currentConfig)
          .then((r) => {
            if (!r) return;
            const s = getActiveSession();
            if (s) setMemories(s.memories);
            appLog(`[memory] 自动摘要完成：${r.summarized} 条旧消息已并入长期记忆（原文保留）`);
          })
          .catch(() => { /* 摘要失败不影响聊天 */ })
          .finally(() => {
            summarizingRef.current = false;
          });
      }
    } catch {
      streamingRef.current = false;
      pendingReplyRef.current = false;
      // 中断流式 TTS 队列（已播的一声自然结束，未合成的不再继续）
      streamTTSQueueRef.current?.cancel();
      streamTTSQueueRef.current = null;
      setPlayingMessageIndex(null);
      setMessages((prev) => [...prev, { role: "assistant", content: "通信中断..." }]);
      setLoading(false);
    }
  };

  return (
    <div className="relative h-full w-full text-white" style={{ backgroundImage: `url(${character.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundColor: '#000', overflow: 'hidden' }}>
      {/* 背景音乐：循环播放，切换会话或开关 BGM 时从头开始 */}
      <audio
        ref={(el) => { audioRef.current = el; }}
        key={`bgm-${activeSession?.id ?? "init"}`}
        src={character.bgm}
        autoPlay
        loop
      />

      {/* 立绘全屏背景 */}
      <div className="absolute inset-0 flex items-end justify-center">
        {/* 宽高由 CSS 决定（高 100%、宽 = 400/1280 舞台宽），
            窗口变化时浏览器直接重排，不需要等 JS —— 这是"不闪"的关键。
            canvas 内部渲染分辨率另外按 pixelRatio 提高，保证清晰。 */}
        <div style={{ height: "100%", width: `${(400 / 1280) * 100}%` }}>
          <Live2D modelPath={character.live2dPath} pixelRatio={stageMetrics.scale} />
        </div>
      </div>

      {/* 2026-10-25：header 本身设 pointer-events-none，让空白区域的事件穿透到
          下层的窗口拖动条（WindowBar），否则顶部那条区域拖不动窗口。
          内部真正要点的元素（logo / 两个按钮）单独设回 pointer-events-auto。 */}
      <header className="absolute top-0 left-0 right-0 p-4 flex items-center pointer-events-none" style={{ zIndex: 30 }}>
        <SpritePlayer
          src={character.spriteLogo}
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
          style={{ marginLeft: '1.25rem', pointerEvents: 'auto' }}
        />
        {/* 背景音乐开关（从设置面板挪到主界面右上角） */}
        <button
          onClick={() => {
            const next = !bgmEnabled;
            setBgmEnabled(next);
            localStorage.setItem("amadeus_bgm_enabled", String(next));
            appLog(`背景音乐${next ? "开启" : "关闭"}`);
          }}
          className="absolute right-[6rem] top-4 p-2 text-zinc-400 hover:text-white transition-colors pointer-events-auto"
          aria-label="背景音乐"
        >
          {bgmEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.75V19.5m0 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm0-9.75L19.5 6.75v9.75m0 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0V6.75" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.75V19.5m0 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm0-9.75L19.5 6.75v9.75m0 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0V6.75" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" />
            </svg>
          )}
        </button>

        <button
          onClick={() => setSettingsOpen(true)}
          className="text-zinc-400 hover:text-white transition-colors p-2 absolute right-[8.5rem] top-4 pointer-events-auto"
          aria-label="设置"
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
          height: '17.5rem',
          zIndex: 20,
          backgroundImage: 'url(/meswin.png)',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
          backgroundPosition: 'left bottom',
        }}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {/* 顶部留白 */}
        <div style={{ height: '1.25rem', flexShrink: 0 }} />

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
        <div className="relative flex flex-col justify-end" style={{ height: '4.375rem', paddingBottom: '1.25rem' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.markdown"
            onChange={handleFileInputChange}
            className="hidden"
          />
          {/* 文档/图片被拒时的提示条 */}
          {docHint && (
            <div className="absolute bottom-16 left-4 z-10 rounded-lg border border-amber-700/60 bg-amber-900/70 px-3 py-1.5 text-xs font-mono text-amber-200 shadow-lg">
              {docHint}
            </div>
          )}
          {/* 图片预览 */}
          {imagePreview && (
            <div className="absolute bottom-16 left-4 flex items-end gap-2 z-10">
              <div className="relative">
                <img src={imagePreview} alt="预览" className="w-20 h-20 object-cover rounded-lg border border-zinc-600" />
                <button
                  onClick={removeImage}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            onInput={() => updateCursorPosition()}
            onFocus={() => updateCursorPosition()}
            onClick={() => updateCursorPosition()}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            onPaste={handlePaste}
              className="w-full bg-transparent text-zinc-100 font-mono resize-none outline-none text-center"
              style={{
                fontSize: '1.1rem',
                textShadow: '1px 1px 3px #000, 0 0 1px #fff',
                padding: '0 14vw',
                lineHeight: '1.6',
                letterSpacing: '0.05em',
                scrollbarWidth: 'none',
                maxHeight: '6.25rem',
              }}
            />
            {/* 图片/文档按钮（左下角） */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute left-4 bottom-1 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-700/80 text-zinc-300 hover:bg-zinc-600 hover:text-white transition-all"
              title="发送图片或文档（txt / md）"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
              </svg>
            </button>
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
              style={{ left: `${cursorPos.x + 8}px`, top: `${cursorPos.y - 4}px` }}
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
                const greetEmotion = parseMessage(session.messages[0].content).emotion ?? "neutral";
                synthesizeSpeech(ttsText, latestTTS, greetEmotion).then(audio => {
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
