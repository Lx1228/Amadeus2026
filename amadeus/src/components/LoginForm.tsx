"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import SpritePlayer from "./SpritePlayer";
import { setSessionLoggedIn } from "@/lib/auth";

/**
 * Amadeus 登录界面（复刻自 MAHO-Amadeus 项目的 login.vue）
 * - 全屏 bgLogin.jpg 背景
 * - 顶部 SpritePlayer logo（sprite_logo.png 6×7 / 38 帧）
 * - 中下 USER ID / PASSWORD 输入框 + 登录按钮
 * - 背景 BGM：login.mp3 循环
 *
 * 登录逻辑：本项目无后端认证，简化为任意输入即可登录，
 * 把用户名存 localStorage 后跳转到主页。
 */
export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  // 登录界面整体同步缩放：以 900px 高度为基准，scale 随窗口高度变化
  // 最外层 div 设置 fontSize = baseFont * scale，内部所有 em 单位会跟着按比例缩放
  const BASE_HEIGHT = 900;
  const BASE_FONT = 16;
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => setScale(window.innerHeight / BASE_HEIGHT);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 浏览器自动播放策略：首次点击触发 BGM
  useEffect(() => {
    const onFirstClick = () => {
      if (bgmRef.current) {
        bgmRef.current.play().catch(() => { /* 静默失败 */ });
      }
    };
    document.addEventListener("click", onFirstClick, { once: true });
    return () => document.removeEventListener("click", onFirstClick);
  }, []);

  // 已登录直接跳主页（会话级内存变量，刷新会丢）
  useEffect(() => {
    // 不检查 localStorage——刷新必须重新登录
  }, [router]);

  const handleLogin = () => {
    if (!username.trim()) {
      setErrorMsg("请输入 USER ID");
      return;
    }
    if (!password.trim()) {
      setErrorMsg("请输入 PASSWORD");
      return;
    }
    // 账号密码从环境变量读取（.env.local，不传 GitHub）
    const loginUser = process.env.NEXT_PUBLIC_LOGIN_USER || "Amadeus";
    const loginPass = process.env.NEXT_PUBLIC_LOGIN_PASS || "";
    if (username.trim() !== loginUser || password.trim() !== loginPass) {
      setErrorMsg("USER ID 或 PASSWORD 错误");
      return;
    }
    // 校验通过，存内存会话登录态
    setSessionLoggedIn(true);
    router.push("/");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div
      style={{
        backgroundImage: "url(/bgLogin.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        fontSize: `${BASE_FONT * scale}px`,
      }}
    >
      <audio ref={bgmRef} src="/login.mp3" autoPlay loop />

      {/* 顶部 Logo（SpritePlayer：6 行 7 列 38 帧） */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 0,
        }}
      >
        <SpritePlayer
          src="/sprite_logo.png"
          rows={6}
          columns={7}
          fps={20}
          width={80}
          height={80}
          totalFrames={38}
          loop={1}
          displayWidth={520 * scale}
          displayHeight={520 * scale}
        />
      </div>

      {/* 输入组：USER ID / PASSWORD + 按钮 */}
      <div
        style={{
          position: "absolute",
          top: "70%",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          zIndex: 1,
          maxWidth: "95vw",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            marginRight: "1em",
          }}
        >
          <div style={{ display: "flex", marginBottom: "1.2em" }}>
            <span style={labelStyle}>USER ID</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              name="amadeus-user-off"
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex" }}>
            <span style={labelStyle}>PASSWORD</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="new-password"
              name="amadeus-pwd-off"
              style={inputStyle}
            />
          </div>
        </div>

        <button
          onClick={handleLogin}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            outline: "none",
            transform: "translateY(1.5em)",
          }}
          onMouseEnter={(e) => {
            const img = e.currentTarget.querySelector("img");
            if (img) img.style.transform = "scale(1.13)";
          }}
          onMouseLeave={(e) => {
            const img = e.currentTarget.querySelector("img");
            if (img) img.style.transform = "scale(1)";
          }}
        >
          <img
            src="/login_button.png"
            alt="登录"
            style={{
              width: "2.8em",
              transition: "transform 0.2s cubic-bezier(.4, 2, .3, 1)",
            }}
          />
        </button>
      </div>

      {errorMsg && (
        <p
          style={{
            color: "red",
            marginTop: "1em",
            position: "absolute",
            top: "78%",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "1.2rem",
            zIndex: 2,
          }}
        >
          {errorMsg}
        </p>
      )}
    </div>
  );
}

// 标签样式：高光金黄 + 发光阴影 + Cinzel serif
const labelStyle: React.CSSProperties = {
  transform: "translateY(0.26em)",
  marginRight: "1em",
  display: "flex",
  alignItems: "center",
  fontFamily: "'Cinzel', 'Times New Roman', serif",
  fontSize: "1.8em",
  fontWeight: 500,
  color: "#F2B03A",
  letterSpacing: "3px",
  marginBottom: "0.4em",
  textShadow:
    "0 0 6px rgba(224, 85, 30, 0.8), 0 0 14px rgba(209, 139, 36, 0.5), 0 0 24px rgba(0, 0, 0, 0.9)",
  whiteSpace: "nowrap",
};

// 输入框样式：黑底古铜黄边 + 高光金黄文字 + Consolas 等宽
const inputStyle: React.CSSProperties = {
  width: "20em",
  height: "1.6em",
  background: "#000000",
  border: "2px solid #D18B24",
  color: "#F2B03A",
  padding: "0 1rem",
  fontFamily: "'Consolas', 'monospace'",
  fontSize: "1.8em",
  letterSpacing: "2px",
  outline: "none",
  boxShadow: "0 0 15px rgba(224, 85, 30, 0.5)",
  boxSizing: "content-box",
};
