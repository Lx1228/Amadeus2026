"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import SpritePlayer from "./SpritePlayer";
import { useStageHeight } from "./ViewportScaler";
import { setSessionLoggedIn, setSessionCharacterId } from "@/lib/auth";
import { findCharacterByLogin, DEFAULT_CHARACTER } from "@/lib/characters";

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
  const [savedAccounts, setSavedAccounts] = useState<Record<string, string>>({});
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  // 登录界面缩放基准（2026-10-25）
  // 整体缩放已改由根字号驱动（见 app/layout.tsx：html fontSize = 100vw/80），
  // 这里只需要把内部 em 单位对齐到与聊天页一致的比例 —— 基准取舞台设计高度 720。
  const BASE_HEIGHT = 720;
  const BASE_FONT = 16;
  const stageHeight = useStageHeight();
  const scale = stageHeight / BASE_HEIGHT;

  // 浏览器自动播放策略：首次点击触发 BGM
  useEffect(() => {
    const onFirstClick = () => {
      if (bgmRef.current && localStorage.getItem("amadeus_bgm_enabled") !== "false") {
        bgmRef.current.play().catch(() => { /* 静默失败 */ });
      }
    };
    document.addEventListener("click", onFirstClick, { once: true });
    return () => document.removeEventListener("click", onFirstClick);
  }, []);

  // 背景音乐开关（与主界面共用同一个偏好 key：登录页和聊天页联动）
  // 登录页每次进入都默认开着音乐（2026-10-18 用户定案）；
  // 点开关后写入偏好 key，主界面按上一次的开关状态来
  const [bgmOn, setBgmOn] = useState(true);
  useEffect(() => {
    if (!bgmRef.current) return;
    if (bgmOn) {
      bgmRef.current.volume = 1;
    } else {
      bgmRef.current.pause();
      bgmRef.current.currentTime = 0;
    }
  }, [bgmOn]);

  // 已登录直接跳主页（会话级内存变量，刷新会丢）
  useEffect(() => {
    // 不检查 localStorage——刷新必须重新登录
  }, [router]);

  // 读取所有保存的账号密码，自动填充最近一次登录的
  useEffect(() => {
    const saved = localStorage.getItem("amadeus_saved_logins");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const accounts = data.accounts || {};
        setSavedAccounts(accounts);
        // 自动填充最近登录的账号
        const last = data.lastAccount;
        if (last && accounts[last]) {
          setUsername(last);
          setPassword(accounts[last]);
        }
      } catch { /* 忽略损坏的数据 */ }
    }
  }, []);

  const handleLogin = () => {
    if (!username.trim()) {
      setErrorMsg("请输入 USER ID");
      return;
    }
    if (!password.trim()) {
      setErrorMsg("请输入 PASSWORD");
      return;
    }
    // 按账号密码查角色（支持多角色，每个角色不同账号密码）
    const character = findCharacterByLogin(username, password);
    if (!character) {
      setErrorMsg("USER ID 或 PASSWORD 错误");
      return;
    }
    // 校验通过，存内存会话登录态 + 角色 ID
    setSessionLoggedIn(true);
    setSessionCharacterId(character.id);
    // 记住账号密码：勾选则保存到 localStorage（支持多账号），没勾则删除当前账号
    const savedRaw = localStorage.getItem("amadeus_saved_logins");
    let data: { accounts: Record<string, string>; lastAccount: string } = { accounts: {}, lastAccount: "" };
    try { data = JSON.parse(savedRaw || "{}"); } catch { /* 用默认 */ }
    if (!data.accounts) data.accounts = {};
    // 2026-10-18 用户定案：三个账号恒记住，不再依赖勾选框
    data.accounts[username.trim()] = password.trim();
    data.lastAccount = username.trim();
    localStorage.setItem("amadeus_saved_logins", JSON.stringify(data));
    setSavedAccounts(data.accounts);
    router.push("/");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div
      style={{
        backgroundImage: `url(${DEFAULT_CHARACTER.bgLoginImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "100%",
        position: "relative",
        overflowX: "visible",
        overflowY: "hidden",
        fontSize: `${BASE_FONT * scale}px`,
      }}
    >
      <audio ref={bgmRef} src={DEFAULT_CHARACTER.bgm} autoPlay loop />

      {/* 背景音乐开关（与主界面共用同一偏好 key）
          2026-10-25：样式改成和聊天界面那颗音符完全一致（纯图标、无方框背景），
          位置也统一到 right-[6rem] —— 登录页 3 个图标、聊天页 4 个（多一个设置），
          把"设置"排在更左边，BGM 位置就两页恒定。 */}
      <button
        onClick={() => {
          const next = !bgmOn;
          setBgmOn(next);
          localStorage.setItem("amadeus_bgm_enabled", String(next));
          console.log(`[BGM] 登录页背景音乐已${next ? "开启" : "关闭"}`);
        }}
        aria-label="背景音乐"
        className="absolute right-[6rem] top-4 p-2 text-zinc-400 hover:text-white transition-colors"
        style={{ zIndex: 60 }}
      >
        {bgmOn ? (
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
          src={DEFAULT_CHARACTER.spriteLogo}
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

      {/* 输入组：USER ID / PASSWORD（保持最初的布局） */}
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
          {/* 记住账号密码复选框 */}
          {/* 已保存的账号快速选择：2个以上才显示 */}
          {Object.keys(savedAccounts).length > 1 && (
            <div style={{ alignSelf: "flex-end", marginTop: "0.5em", display: "flex", gap: "0.5em", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {Object.keys(savedAccounts).map((acct) => (
                <button
                  key={acct}
                  onClick={() => {
                    setUsername(acct);
                    setPassword(savedAccounts[acct]);
                            }}
                  style={{
                    background: username === acct ? "#D18B24" : "rgba(0,0,0,0.6)",
                    border: "1px solid #D18B24",
                    color: "#F2B03A",
                    padding: "0.2em 0.8em",
                    fontFamily: "'Consolas', 'monospace'",
                    fontSize: "0.95em",
                    cursor: "pointer",
                    borderRadius: "3px",
                    textShadow: "0 0 4px rgba(0,0,0,0.9)",
                  }}
                >
                  {acct}
                </button>
              ))}
            </div>
          )}
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
            flexShrink: 0,
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
              height: "2.8em",
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
