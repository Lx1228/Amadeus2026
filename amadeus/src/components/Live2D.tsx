"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Application, FederatedPointerEvent } from "pixi.js";
import type { Live2DModel as Live2DModelType } from "pixi-live2d-display/cubism4";

interface Live2DProps {
  modelPath: string;
  width?: number;
  height?: number;
  onModelReady?: (model: Live2DModelType) => void;
}

type EmotionType = "angry" | "blush" | "smile" | "sad" | "neutral" | "surprised" | "shy";

// === 眨眼频率常量（秒）—— 改这里即可调整眨眼快慢 ===
const BLINK_INTERVAL_S = 4;  // 两次眨眼之间的间隔
const BLINK_CLOSE_S = 0.1;     // 闭眼过程用时（Cubism 官方默认）
const BLINK_CLOSED_S = 0.05;   // 完全闭着用时（Cubism 官方默认）
const BLINK_OPEN_S = 0.1;      // 睁眼过程用时（Cubism 官方默认）

export default function Live2D({ modelPath, width = 400, height = 600, onModelReady }: Live2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const appRef = useRef<Application | null>(null);
  const errorHandlerRef = useRef<((e: ErrorEvent) => void) | null>(null);
  // init 运行标记：防止 StrictMode 双调用 / HMR 重入导致重复创建
  const initStartedRef = useRef(false);

  const init = useCallback(async () => {
    if (!containerRef.current || appRef.current || initStartedRef.current) return;
    initStartedRef.current = true;

    let isDestroyed = false;
    let modelRef: Live2DModelType | null = null;

    try {
      errorHandlerRef.current = (e: ErrorEvent) => {
        if (e.message?.includes("Cubism") || e.message?.includes("resolveURL") ||
            e.message?.includes("Live2D") || e.message?.includes("basePointIndex")) {
          e.stopImmediatePropagation();
        }
      };
      window.addEventListener("error", errorHandlerRef.current);

      // 加载 Cubism Core SDK
      const script = document.createElement("script");
      script.src = "/live2dcubismcore.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => { script.onload = resolve; });
      if (isDestroyed) return;

      const PIXI = await import("pixi.js");
      const { Live2DModel } = await import("pixi-live2d-display/cubism4");
      (window as unknown as { PIXI: typeof import("pixi.js") }).PIXI = PIXI;
      if (isDestroyed) return;

      // Canvas
      const canvas = document.createElement("canvas");
      const lockStyle = () => {
        canvas.style.background = "transparent";
        canvas.style.backgroundColor = "transparent";
        canvas.style.outline = "none";
      };
      lockStyle();
      const styleObserver = new MutationObserver(() => {
        if (canvas.style.background !== "transparent" || canvas.style.backgroundColor !== "transparent") lockStyle();
      });
      styleObserver.observe(canvas, { attributes: true, attributeFilter: ["style"] });

      appRef.current = new PIXI.Application({
        view: canvas, width, height,
        backgroundAlpha: 0, premultipliedAlpha: false,
        clearBeforeRender: true, antialias: true, powerPreference: "high-performance",
      });
      lockStyle();

      // 加载模型
      console.log("[Live2D] 加载模型...", modelPath);
      const model = (await Live2DModel.from(modelPath, { autoHitTest: true, autoFocus: true })) as Live2DModelType;
      if (isDestroyed) { model.destroy(); return; }
      modelRef = model;
      console.log("[Live2D] 模型加载成功, 尺寸:", model.width, "x", model.height);

      model.anchor.set(0.5, 0.5);
      model.scale.set(0.3);
      model.x = appRef.current.screen.width / 2;
      model.y = appRef.current.screen.height * 0.65;
      appRef.current.stage.addChild(model);
      console.log("[Live2D] 模型已添加到舞台, 位置:", model.x, model.y, "缩放:", model.scale.x);

      // 鼠标跟随
      appRef.current.stage.eventMode = "static";
      appRef.current.stage.hitArea = appRef.current.screen;
      appRef.current.stage.on("pointermove", (e: FederatedPointerEvent) => {
        if (!isDestroyed) model.focus(e.global.x, e.global.y);
      });

      // 内部模型
      const internalModel = model.internalModel as unknown as {
        update: (dt: number, now: number) => void;
        updateFocus: () => void;
        eyeBlink?: { setBlinkingInterval: (s: number) => void; setBlinkingSetting: (c: number, cd: number, o: number) => void; };
        coreModel: {
          setParameterValueById: (id: string, value: number) => void;
          addParameterValueById: (id: string, value: number, weight?: number) => void;
        };
      };

      // 提高眨眼频率：库默认间隔 4s，这里同步设为 BLINK_INTERVAL_S（手动眨眼为主，此为 fallback）
      if (internalModel.eyeBlink) {
        try {
          internalModel.eyeBlink.setBlinkingInterval(BLINK_INTERVAL_S);
          internalModel.eyeBlink.setBlinkingSetting(BLINK_CLOSE_S, BLINK_CLOSED_S, BLINK_OPEN_S);
          console.log(`[Live2D] 库眨眼间隔已设为 ${BLINK_INTERVAL_S}s`);
        } catch (e) {
          console.warn("[Live2D] 设置眨眼参数失败:", e);
        }
      }

      // 包装 updateFocus：保留 motion 的身体动作
      // 库默认 updateFocus 用 addParameterValueById 叠加（focus.x * 10），不会覆盖 motion 的值
      // 之前用 setParameterValueById("ParamBodyAngleX", 0) 会覆盖 motion 设置，导致 mtn_01/02/03
      // 中 ParamBodyAngleX 曲线驱动的身体转动动作完全不触发
      const originalUpdateFocus = internalModel.updateFocus.bind(internalModel);
      internalModel.updateFocus = () => {
        originalUpdateFocus();
        // 不再强制清零 ParamBodyAngleX，让 motion 自由控制身体转动
      };

      // 动作触发（仅用于 idle 待机动作；TapBody 魔法动作已移除）
      const playMotion = (group: string, index: number = 0) => {
        if (isDestroyed || !modelRef) return;
        try {
          (modelRef as unknown as { motion: (g: string, i: number, p: number) => void }).motion(group, index, 3);
          console.log(`[Live2D] 触发动作: ${group}[${index}]`);
        } catch (e) {
          console.warn("[Live2D] 动作触发失败:", e);
        }
      };

      // 情绪 + 嘴唇同步状态
      const emotionState = { angry: 0, blush: 0, smile: 0, sad: 0, surprised: 0, shy: 0 };
      const emotionTarget = { angry: 0, blush: 0, smile: 0, sad: 0, surprised: 0, shy: 0 };
      let isSpeaking = false;
      let analyserRef: AnalyserNode | null = null;
      let lastOpen = 0;
      let lastForm = 0;
      const simStartTime = performance.now();

      // 手动全局眨眼状态机（不依赖库的 eyeBlink，确保待机/聊天/任何状态都眨眼）
      // 库的 CubismEyeBlink 不可靠：可能未创建、或被 motion 系统干扰跳过
      // 频率/时长由文件顶部的常量 BLINK_INTERVAL_S / BLINK_CLOSE_S 等控制
      let blinkAccumTime = 0;        // 距上次眨眼开始累积的秒数
      let blinkPhaseTime = 0;        // 当前眨眼阶段已进行的时间
      let blinkState: "idle" | "closing" | "closed" | "opening" = "idle";
      let lastBlinkNow = performance.now();

      // 包装 update：情绪 + 嘴唇同步 + 手动全局眨眼
      const originalUpdate = internalModel.update.bind(internalModel);
      internalModel.update = (dt: number, now: number) => {
        originalUpdate(dt, now);
        if (isDestroyed || !modelRef) return;

        // 情绪平滑
        (Object.keys(emotionState) as Array<keyof typeof emotionState>).forEach((k) => {
          const diff = emotionTarget[k] - emotionState[k];
          if (Math.abs(diff) > 0.001) emotionState[k] += diff * 0.15;
        });

        // 手动眨眼状态机推进（用 performance.now 自算 dt，不依赖库的 eyeBlink）
        const nowMs = performance.now();
        const dtSec = (nowMs - lastBlinkNow) / 1000;
        lastBlinkNow = nowMs;
        if (blinkState === "idle") {
          blinkAccumTime += dtSec;
          if (blinkAccumTime >= BLINK_INTERVAL_S) {
            blinkState = "closing";
            blinkPhaseTime = 0;
            blinkAccumTime = 0;
          }
        } else {
          blinkPhaseTime += dtSec;
          if (blinkState === "closing" && blinkPhaseTime >= BLINK_CLOSE_S) {
            blinkState = "closed";
            blinkPhaseTime = 0;
          } else if (blinkState === "closed" && blinkPhaseTime >= BLINK_CLOSED_S) {
            blinkState = "opening";
            blinkPhaseTime = 0;
          } else if (blinkState === "opening" && blinkPhaseTime >= BLINK_OPEN_S) {
            blinkState = "idle";
            blinkPhaseTime = 0;
          }
        }
        // 计算当前眼睛开合度 0~1
        let manualEyeOpen = 1;
        if (blinkState === "closing") {
          manualEyeOpen = 1 - blinkPhaseTime / BLINK_CLOSE_S;
        } else if (blinkState === "closed") {
          manualEyeOpen = 0;
        } else if (blinkState === "opening") {
          manualEyeOpen = blinkPhaseTime / BLINK_OPEN_S;
        }
        if (manualEyeOpen < 0) manualEyeOpen = 0;
        if (manualEyeOpen > 1) manualEyeOpen = 1;

        // 嘴唇同步
        let mouthOpen = 0;
        let mouthForm = 0;
        if (isSpeaking) {
          if (analyserRef) {
            const timeData = new Uint8Array(analyserRef.frequencyBinCount);
            analyserRef.getByteTimeDomainData(timeData);
            let sum = 0;
            for (let i = 0; i < timeData.length; i++) { const v = (timeData[i] - 128) / 128; sum += v * v; }
            const rms = Math.sqrt(sum / timeData.length);
            const freqData = new Uint8Array(analyserRef.frequencyBinCount);
            analyserRef.getByteFrequencyData(freqData);
            const lowEnergy = freqData.slice(0, 8).reduce((a, b) => a + b, 0) / 8 / 255;
            const highEnergy = freqData.slice(8, 40).reduce((a, b) => a + b, 0) / 32 / 255;
            const targetOpen = Math.min(1, rms * 5.5 + lowEnergy * 0.3);
            lastOpen = lastOpen * 0.35 + targetOpen * 0.65;
            const targetForm = (lowEnergy - highEnergy) * 1.5;
            lastForm = lastForm * 0.6 + targetForm * 0.4;
            mouthOpen = lastOpen;
            mouthForm = Math.max(-1, Math.min(1, lastForm));
          } else {
            const elapsed = (performance.now() - simStartTime) / 1000;
            const base = Math.sin(elapsed * 7) * 0.25 + Math.sin(elapsed * 13) * 0.15 + Math.sin(elapsed * 19) * 0.1;
            mouthOpen = Math.max(0, Math.min(1, base + (Math.random() - 0.5) * 0.15 + 0.25));
            mouthForm = Math.sin(elapsed * 5) * 0.3;
          }
        } else {
          lastOpen *= 0.85;
          lastForm *= 0.85;
          mouthOpen = lastOpen;
          mouthForm = lastForm;
        }

        try {
          const core = internalModel.coreModel;
          const si = emotionState.smile;
          const sad = emotionState.sad;

          // 情绪参数（motion 文件不包含 Param8/Param9/ParamEyeRSmile，可始终设置）
          core.setParameterValueById("Param8", emotionState.angry);
          core.setParameterValueById("Param9", Math.max(emotionState.blush, emotionState.shy * 0.8));
          core.setParameterValueById("ParamEyeRSmile", si);

          // ParamEyeROpen / ParamEyeLOpen：手动全局眨眼驱动
          // - smile：眯眼（半闭，覆盖眨眼）
          // - sad：半闭眼（覆盖眨眼）
          // - 其他：用手动眨眼状态机的值（待机/聊天/任何状态都眨）
          let eyeOpenValue: number;
          if (si > 0.01) {
            eyeOpenValue = Math.max(0, 1 - si * 0.6);
          } else if (sad > 0.01) {
            eyeOpenValue = Math.max(0.3, 1 - sad * 0.5);
          } else {
            eyeOpenValue = manualEyeOpen;
          }
          core.setParameterValueById("ParamEyeROpen", eyeOpenValue);
          core.setParameterValueById("ParamEyeLOpen", eyeOpenValue);

          // ParamMouthForm：只在有表情或说话时覆盖；否则让 motion 自由控制
          if (si > 0.01) {
            core.setParameterValueById("ParamMouthForm", Math.max(mouthForm, si * 0.4));
          } else if (sad > 0.01) {
            core.setParameterValueById("ParamMouthForm", -sad * 0.5);
          } else if (isSpeaking || Math.abs(mouthForm) > 0.01) {
            core.setParameterValueById("ParamMouthForm", mouthForm);
          }

          // ParamMouthOpenY：只在说话或非零时覆盖
          if (isSpeaking || Math.abs(mouthOpen) > 0.01) {
            core.setParameterValueById("ParamMouthOpenY", mouthOpen);
          }
        } catch { /* 忽略 */ }
      };

      // 自动待机动作（仅播放 idle，不再随机播 TapBody 魔法动作）
      const startIdleMotion = () => {
        if (isDestroyed || !modelRef) return;
        setTimeout(() => {
          if (!isDestroyed && modelRef) {
            playMotion("Idle", 0);
            console.log("[Live2D] 待机动作已启动");
          }
        }, 2000);
      };

      // 情绪事件（只驱动面部参数，不再触发身体动作）
      const triggerEmotion = (emotion: EmotionType, intensity: number = 1) => {
        Object.keys(emotionTarget).forEach((k) => { emotionTarget[k as keyof typeof emotionTarget] = 0; });
        switch (emotion) {
          case "angry": emotionTarget.angry = intensity; break;
          case "blush": emotionTarget.blush = intensity; break;
          case "smile": emotionTarget.smile = intensity; break;
          case "sad": emotionTarget.sad = intensity; emotionTarget.angry = intensity * 0.3; break;
          case "surprised": emotionTarget.surprised = intensity; emotionTarget.blush = intensity * 0.3; break;
          case "shy": emotionTarget.shy = intensity; emotionTarget.blush = intensity * 0.6; break;
        }
      };

      const handleEmotion = (event: Event) => {
        if (isDestroyed) return;
        const d = (event as CustomEvent).detail as { emotion: EmotionType; intensity?: number } | undefined;
        if (d) triggerEmotion(d.emotion, d.intensity ?? 1);
      };

      const handleTTSStart = (event: Event) => {
        if (isDestroyed) return;
        const d = (event as CustomEvent).detail as { analyser: AnalyserNode | null } | undefined;
        analyserRef = d?.analyser || null;
        isSpeaking = true;
        lastOpen = 0;
        lastForm = 0;
      };

      const handleTTSEnd = () => {
        isSpeaking = false;
        analyserRef = null;
      };

      window.addEventListener("amadeus-emotion", handleEmotion as EventListener);
      window.addEventListener("amadeus-tts-start", handleTTSStart as EventListener);
      window.addEventListener("amadeus-tts-end", handleTTSEnd);

      // 清理
      (appRef.current as unknown as { _cleanup: () => void })._cleanup = () => {
        console.log("[Live2D] cleanup 触发，销毁模型和 app");
        isDestroyed = true;
        window.removeEventListener("amadeus-tts-start", handleTTSStart as EventListener);
        window.removeEventListener("amadeus-tts-end", handleTTSEnd);
        window.removeEventListener("amadeus-emotion", handleEmotion as EventListener);
      };

      // 挂载
      lockStyle();
      const onFirstFrame = () => {
        if (isDestroyed || !containerRef.current) {
          console.warn("[Live2D] onFirstFrame 跳过: isDestroyed=", isDestroyed, "container=", !!containerRef.current);
          return;
        }
        // 防御：挂载前清掉容器内残留的旧 canvas（HMR/StrictMode 残留）
        // 注意：如果当前 app 的 canvas 已经在容器里（HMR 重渲染），不要误删
        const existing = containerRef.current.querySelectorAll("canvas");
        if (existing.length > 0 && !Array.from(existing).includes(canvas)) {
          existing.forEach((c) => c.remove());
        }
        if (!canvas.parentElement) {
          lockStyle();
          containerRef.current.appendChild(canvas);
        }
        setReady(true);
        if (onModelReady) onModelReady(model);
        const rect = canvas.getBoundingClientRect();
        console.log(`[Live2D] 首帧渲染完成, canvas 已挂载。尺寸: ${canvas.width}x${canvas.height}, 显示位置: left=${rect.left} top=${rect.top} w=${rect.width} h=${rect.height}, 容器children: ${containerRef.current.children.length}`);
        startIdleMotion();
      };
      appRef.current.ticker.addOnce(onFirstFrame);
      setTimeout(() => {
        if (!isDestroyed && containerRef.current && !containerRef.current.contains(canvas)) {
          console.log("[Live2D] 500ms 超时兜底: 挂载 canvas");
          lockStyle();
          containerRef.current.appendChild(canvas);
          setReady(true);
          if (onModelReady) onModelReady(model);
          startIdleMotion();
        } else {
          console.log("[Live2D] 500ms 超时兜底: 跳过 (canvas 已挂载或组件已销毁)");
        }
      }, 500);

    } catch (error) {
      console.error("[Live2D] 模型加载失败:", error);
      if (containerRef.current) containerRef.current.style.display = "none";
      setReady(true);
    }
  }, [modelPath, width, height, onModelReady]);

  useEffect(() => {
    init();
    return () => {
      console.log("[Live2D] useEffect cleanup 运行");
      initStartedRef.current = false; // 允许下次 init 重新运行
      if (errorHandlerRef.current) window.removeEventListener("error", errorHandlerRef.current);
      if (appRef.current) {
        const cleanup = (appRef.current as unknown as { _cleanup?: () => void })._cleanup;
        if (cleanup) cleanup();
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
        console.log("[Live2D] app 已 destroy, appRef 已置 null");
      }
      // 清理容器内残留 canvas
      if (containerRef.current) {
        const canvases = containerRef.current.querySelectorAll("canvas");
        canvases.forEach((c) => c.remove());
      }
    };
  }, [init]);

  return (
    <div
      ref={containerRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 10,
        background: "transparent",
        backgroundColor: "transparent",
        display: ready ? "block" : "none",
      }}
      className="pointer-events-auto"
    />
  );
}
