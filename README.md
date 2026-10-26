# Amadeus - 命运石之门数字伴侣

基于《命运石之门》角色的数字伴侣应用，支持三个角色：牧濑红莉栖、比屋定真帆、椎名真由理。通过 Live2D 模型、LLM 聊天与 TTS 语音合成，打造可以对话的 AI 角色。

## 功能特性

- 🎭 **多角色系统** - 三个角色（红莉栖/真帆/真由理），输入不同账号密码加载不同角色
- 💬 **LLM 对话** - 内置小米 MiMo、DeepSeek 模型，也支持自定义 OpenAI 兼容接口，流式输出
- 🔊 **语音合成** - 云端语音（阿里云百炼 CosyVoice），填入自己的 API Key、一键复刻三角色音色，回复自动朗读
- 🗨️ **口癖原声** - 嘟嘟噜等标志性台词直接播放原声片段
- 🖼️ **图片与文档发送** - 支持图片、txt / md 文本文件，AI 直接读取内容
- 😊 **情感系统** - 5 种情绪驱动 Live2D 表情
- 🗂️ **会话管理** - 每个角色一个会话，自动记忆整理，支持导出聊天记录到 TXT
- 🪵 **运行日志** - 内置日志面板，后台状态与报错实时可见
- 🖥️ **桌面应用** - 基于 Tauri，自绘标题栏 + 系统托盘，双击安装即用

## 角色账号

| 账号 | 密码 | 角色 |
|------|------|------|
| Amadeus | 0728 | 牧濑红莉栖 |
| Salieri | Maho | 比屋定真帆 |
| Tutturu | Mayuri | 椎名真由理 |

每个角色有独立的 Live2D 模型、人设、音色、聊天记录。LLM 和 TTS 的 API Key 三个角色共享，只需配置一次。

## 下载安装

直接从 [GitHub Release](https://github.com/Lx1228/Amadeus2026/releases) 下载安装包，双击覆盖安装即可。

无需安装 Node.js 或其他依赖，安装包已内置运行时；升级不会丢失聊天记录。

## 语音配置（三步）

1. 注册**阿里云百炼**账号，拿到 API Key
2. Amadeus → 设置 → 语音合成 → 粘贴 API Key
3. 点「一键复刻三个角色」→ 打开「启用」开关

复刻完全免费，只有之后每句合成按字符计费（0.8 元 / 万字符）。不填 Key 一切正常，只是她不说话。

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
   - 内置：小米 MiMo、DeepSeek
   - 或自定义 OpenAI 兼容接口（地址和模型名自己填）

2. **语音合成** - 填入阿里云百炼 API Key，点「一键复刻三个角色」

## 构建桌面应用

```bash
npx tauri build
```

这一条命令会自动完成：
1. `next build`（生成 standalone 输出）
2. `node scripts/build-for-tauri.mjs`（组装 standalone 目录 + 复制 node.exe）
3. Rust release 编译
4. 生成 .msi / .exe 安装包

打包完成后在 `src-tauri/target/release/bundle/nsis/` 目录找到安装包。

**安装包架构**：Tauri 把 Node.js 运行时 + Next.js standalone 服务器打包进安装包。用户双击安装后，桌面快捷方式打开应用时，Tauri 在后台静默启动 Node.js 服务器（无控制台窗口），用户只看到一个应用窗口。

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS 4
- **桌面**: Tauri 2 (Rust)
- **Live2D**: pixi.js + pixi-live2d-display
- **LLM**: OpenAI 兼容 API
- **TTS**: 阿里云百炼 CosyVoice（cosyvoice-v3.5-flash）

## 项目结构

```
amadeus/
├── src/
│   ├── app/               # Next.js 页面和 API 路由
│   │   └── api/
│   │       ├── chat/      # LLM 对话接口
│   │       ├── sessions/  # 会话备份与归档
│   │       ├── tts/       # 云端语音合成 + 音色复刻
│   │       └── app-logs/  # 运行日志
│   ├── components/         # React 组件（Chat, Live2D, Settings, WindowBar, RuntimeLogPanel）
│   └── lib/               # 工具库
│       ├── characters.ts   # 角色配置（多角色系统）
│       ├── tts.ts          # 语音合成（云端）
│       ├── cloud-tts.ts    # 云端语音配置
│       ├── sessions.ts     # 会话管理（按角色隔离 + 单会话迁移）
│       ├── catchphrase.ts  # 口癖原声匹配
│       └── ...
├── public/
│   ├── live2d/            # Live2D 模型（kurisu/maho/MAY）
│   ├── clips/             # 口癖原声片段
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
A: 通常是 API Key 未配置或模型文件缺失，进设置页检查聊天模型配置。

### Q: 她怎么不说话？
A: 三步：设置 → 语音合成 → 填百炼 API Key → 点「一键复刻三个角色」→ 打开「启用」开关。还不行就看 设置 → 运行日志 的报错。

### Q: 音色复刻失败？
A: 常见原因：API Key 无效、阿里云账号未实名、账号额度不足。修正后重试即可。

### Q: 升级版本会丢聊天记录吗？
A: 覆盖安装不会丢。不要卸载旧版。聊天记录存在 `%LOCALAPPDATA%\com.amadeus.kurisu\EBWebView\` 里，并有自动备份。

### Q: 三个角色的聊天记录是分开的吗？
A: 是的，完全隔离。切角色等于切账号，互不影响。每个角色保留一个会话。

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
