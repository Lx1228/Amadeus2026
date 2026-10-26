# Amadeus - 命运石之门数字伴侣

基于《命运石之门》角色的数字伴侣应用，支持三个角色：牧濑红莉栖、比屋定真帆、椎名真由理。通过 Live2D 模型、LLM 聊天和 TTS 语音合成，打造可以对话的 AI 角色。

## 功能特性

- 🎭 **多角色系统** - 三个角色（红莉栖/真帆/真由理），输入不同账号密码加载不同角色
- 💬 **LLM 对话** - 支持 MiMo、DeepSeek 等 OpenAI 兼容 API，流式输出
- 📞 **语音通话** - 全屏通话界面，语音对话循环（说话→ASR识别→LLM回复→TTS播报），像打电话一样
- 🖼️ **图片发送** - 支持选择图片文件或 Ctrl+V 粘贴截图，AI 可识别图片内容回复
- 🔊 **TTS 语音** - 一键克隆音色，每个角色有独立声音，新角色自动克隆
- 😊 **情绪系统** - 5 种情绪驱动 Live2D 表情
- 📝 **会话管理** - 多会话、会话压缩、记忆提取，按角色隔离；支持导出聊天记录到 TXT
- 🖥️ **桌面应用** - 基于 Tauri，双击安装即用，无控制台黑框

## 角色账号

| 账号 | 密码 | 角色 |
|------|------|------|
| Amadeus | 0728 | 牧濑红莉栖 |
| Salieri | Maho | 比屋定真帆 |
| Tutturu | Mayuri | 椎名真由理 |

每个角色有独立的 Live2D 模型、人设、音色、聊天记录。LLM 和 TTS 的 API Key 三个角色共享，只需配置一次。

## 下载安装

直接从 [GitHub Release](https://github.com/Lx1228/Amadeus2026/releases) 下载安装包，双击安装即可。

无需安装 Node.js 或其他依赖，安装包已内置运行时。

## 快速开始（开发者）

### 1. 克隆仓库

```bash
git clone https://github.com/Lx1228/Amadeus2026.git
cd Amadeus2026/amadeus
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env.local`，设置登录密码（仅开发模式需要）：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：
```
NEXT_PUBLIC_LOGIN_USER=Amadeus
NEXT_PUBLIC_LOGIN_PASS=你的密码
```

### 4. 启动开发模式

```bash
npm run build
npx tauri dev
```

### 5. 配置 API Key

登录后点击右上角齿轮图标进入设置：

1. **Chat 模型** - 选择模型提供商，填入 API Key
   - MiMo: https://api.xiaomimimo.com
   - DeepSeek: https://api.deepseek.com
   - 或其他 OpenAI 兼容 API

2. **语音合成** - 填入阿里云 API Key，点「一键克隆」即可

3. **语音输入**（可选）- 填入 ASR API Key（可和对话 Key 相同），开启语音通话功能

## 语音音色

每个角色内置了对应的音色样本，**只需填 API Key 即可一键克隆，无需手动去控制台操作**。

### 阿里云百炼（推荐）

1. 注册阿里云账号，开通「百炼」服务：https://bailian.console.aliyun.com/
2. 获取 API Key（控制台首页 → API-KEY 管理）
3. 打开 Amadeus 应用 → 设置 → 语音合成 → 阿里云百炼
4. 填入阿里云 API Key，点「保存」
5. 点「**一键克隆**」按钮（自动用内置音色样本克隆到你的账号，约 5-15 秒）
6. 克隆成功后引擎会自动切到 Qwen3-TTS-VC，直接去聊天就能听到声音

**每个角色只需克隆一次**，以后切换账号不用重新克隆。三个角色共享同一个阿里云 API Key。

> 一键克隆用的是 Qwen3-TTS-VC 引擎（支持 base64 上传音频，无需公网 URL）。
> 如果想用 CosyVoice 引擎，需要自行到阿里云控制台手动克隆（CosyVoice 要求音频公网 URL），然后把音色 ID 填到设置里。

### MiniMax

1. 注册 MiniMax 账号：https://www.minimaxi.com/
2. 进入控制台 → 「声音复刻」
3. 上传对应角色的音色样本克隆
4. 得到音色 ID 后填入设置

## 构建桌面应用

### 生产模式（打包安装包）

```bash
npx tauri build
```

这一条命令会自动完成：
1. `next build`（生成 standalone 输出）
2. `node scripts/build-for-tauri.mjs`（组装 standalone 目录 + 复制 node.exe）
3. Rust release 编译
4. 生成 .msi / .exe 安装包

打包完成后在 `src-tauri/target/release/bundle/nsis/` 目录找到安装包。

**安装包架构**：Tauri 把 Node.js 运行时 + Next.js standalone 服务器打包进安装包。用户双击安装后，桌面快捷方式打开应用时，Tauri 在后台静默启动 Node.js 服务器（无控制台窗口），用户只看到一个应用窗口。关闭窗口时自动终止服务器进程。

安装包约 34MB（NSIS 压缩后）。

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS 4
- **桌面**: Tauri 2 (Rust)
- **Live2D**: pixi.js + pixi-live2d-display
- **LLM**: OpenAI 兼容 API
- **TTS**: 阿里云 Qwen3-TTS-VC / CosyVoice / MiniMax
- **ASR**: MiMo mimo-v2.5-asr（语音识别）

## 项目结构

```
amadeus/
├── src/
│   ├── app/               # Next.js 页面和 API 路由
│   │   └── api/
│   │       ├── chat/      # LLM 对话接口
│   │       ├── asr/       # ASR 语音识别接口
│   │       └── tts/       # TTS 合成 + 一键克隆接口
│   ├── components/         # React 组件（Chat, Live2D, Settings, VoiceCall, LoginForm）
│   └── lib/               # 工具库
│       ├── characters.ts   # 角色配置（多角色系统）
│       ├── tts.ts          # TTS 合成 + 克隆
│       ├── asr.ts          # ASR 语音识别配置
│       ├── sessions.ts     # 会话管理（按角色隔离）
│       ├── auth.ts         # 登录态 + 角色切换
│       └── ...
├── public/
│   ├── live2d/            # Live2D 模型（kurisu/maho/MAY）
│   ├── voice_sample*.mp3  # 各角色音色样本
│   └── ...
├── scripts/
│   └── build-for-tauri.mjs # 打包脚本
└── src-tauri/             # Tauri 桌面应用配置
```

## Live2D 模型

本项目包含三个角色的 Live2D 模型：

| 角色 | 模型路径 | 来源 |
|------|----------|------|
| 牧濑红莉栖 | `public/live2d/kurisu/` | 开源社区 |
| 比屋定真帆 | `public/live2d/maho-l2d/` | [MAHO-Amadeus](https://github.com/bysq-2006/MAHO-Amadeus) |
| 椎名真由理 | `public/live2d/MAY-l2d/` | [MAHO-Amadeus](https://github.com/bysq-2006/MAHO-Amadeus) |

**注意**: 模型资源来自网络，仅供学习交流，如有侵权请联系删除。

## 常见问题

### Q: 启动后页面空白？
A: 检查浏览器控制台是否有错误，通常是 API Key 未配置或模型文件缺失。

### Q: TTS 没有声音？
A: 1) 确认已点「一键克隆」；2) 确认 TTS 开关已开启；3) 确认引擎是 Qwen3-TTS-VC。

### Q: 一键克隆失败？
A: 常见原因：1) API Key 未填或无效；2) 阿里云账号未实名认证；3) 声音复刻服务未开通。可点「清除标记」后重试。

### Q: 切换角色后声音还是红莉栖的？
A: 每个角色需要各自点一次「一键克隆」。如果已克隆还串音色，确认引擎是 Qwen3-TTS-VC（不要切到 CosyVoice）。v2.1 起新角色首次发消息会自动克隆，无需手动操作。

### Q: 电话按钮看不到？
A: 需要到设置→语音输入里打开开关，按钮才会出现。ASR API Key 可和对话 Key 用同一个。

### Q: 升级版本会丢聊天记录吗？
A: 直接覆盖安装不会丢。不要卸载旧版。聊天记录存在 `%LOCALAPPDATA%\com.amadeus.kurisu\EBWebView\` 里。

### Q: 三个角色的聊天记录是分开的吗？
A: 是的，完全隔离。切角色等于切账号，互不影响。

## 相关项目

- [MAHO-Amadeus](https://github.com/bysq-2006/MAHO-Amadeus) - 真帆和真由理的 Live2D 模型来源
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [Tauri](https://tauri.app/)

## 许可证

本项目代码采用 [MIT 许可证](LICENSE)。

## 免责声明

本项目资源来自网络，仅供学习交流，如有侵权请联系删除。

- 本项目为个人学习项目，非商业用途
- Live2D 模型、音频等资源版权归原作者所有
- 使用本项目产生的任何问题，作者不承担责任
- 如有版权问题，请联系删除相关内容

## 致谢

- 红莉栖 Live2D 模型资源来自开源社区
- 真帆和真由理 Live2D 模型来自 [bysq-2006/MAHO-Amadeus](https://github.com/bysq-2006/MAHO-Amadeus) 项目
- 感谢 [handsome90415/kurisu-live2d-runtime](https://github.com/handsome90415/kurisu-live2d-runtime) 项目的参考
- 感谢所有开源贡献者
