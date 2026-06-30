# Amadeus - 牧濑红莉栖的记忆体

基于《命运石之门》牧濑红莉栖角色的数字伴侣应用，通过 Live2D 模型、LLM 聊天和 TTS 语音合成，打造一个可以对话的 AI 角色。

## 功能特性

- 🎭 **Live2D 角色** - 牧濑红莉栖 Live2D 模型，支持表情驱动和口型同步
- 💬 **LLM 对话** - 支持 MiMo、DeepSeek 等 OpenAI 兼容 API
- 🔊 **TTS 语音** - 支持阿里云 CosyVoice、MiniMax、自定义 TTS 引擎
- 😊 **情绪系统** - 5 种情绪（中性、害羞、生气、开心、难过）驱动 Live2D 表情
- 📝 **会话管理** - 多会话、会话压缩、记忆提取
- 🖥️ **桌面应用** - 基于 Tauri 的桌面客户端，支持 Windows/macOS/Linux

## 快速开始

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

复制 `.env.example` 为 `.env.local`，填入登录密码：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，设置登录账号密码：
```
NEXT_PUBLIC_LOGIN_USER=Amadeus
NEXT_PUBLIC_LOGIN_PASS=你的密码
```

### 4. 启动开发模式

```bash
npm run dev
```

访问 http://localhost:3000，输入账号密码登录。

### 5. 配置 API Key

登录后点击右上角齿轮图标进入设置：

1. **Chat 模型** - 选择模型提供商，填入 API Key
   - MiMo: https://api.xiaomimimo.com
   - DeepSeek: https://api.deepseek.com
   - 或其他 OpenAI 兼容 API

2. **语音合成** - 配置 TTS 引擎
   - 阿里云 CosyVoice（推荐）
   - MiniMax
   - 自定义 TTS

## 构建桌面应用

### 开发模式（热更新）

```bash
npm run build
npx tauri dev
```

### 生产模式（打包安装包）

```bash
npm run build
npx tauri build
```

打包完成后在 `src-tauri/target/release/bundle/` 目录找到安装包。

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS 4
- **桌面**: Tauri 2 (Rust)
- **Live2D**: pixi.js + pixi-live2d-display
- **LLM**: OpenAI 兼容 API
- **TTS**: 阿里云 CosyVoice / MiniMax

## 项目结构

```
amadeus/
├── src/
│   ├── app/           # Next.js 页面和 API 路由
│   ├── components/    # React 组件（Chat, Live2D, Settings）
│   └── lib/           # 工具库（TTS, 记忆, 会话等）
├── public/
│   ├── live2d/        # Live2D 模型文件
│   └── ...            # 静态资源
├── src-tauri/         # Tauri 桌面应用配置
└── start-amadeus.bat  # Windows 启动脚本
```

## Live2D 模型

本项目使用牧濑红莉栖的 Live2D 模型。模型文件位于 `public/live2d/kurisu/` 目录。

**注意**: 模型资源来自网络，仅供学习交流，如有侵权请联系删除。

如需使用其他 Live2D 模型：
1. 将模型文件（.moc3, .model3.json, 纹理等）放到 `public/live2d/` 目录
2. 修改 `src/components/Live2D.tsx` 中的 `modelPath`

## 语音音色

本项目的语音合成（TTS）内置了红莉栖的音色样本，**只需填 API Key 即可一键克隆，无需手动去控制台操作**。

### 阿里云百炼（推荐，最简单）

1. 注册阿里云账号，开通「百炼」服务：https://bailian.console.aliyun.com/
2. 获取 API Key（控制台首页 → API-KEY 管理）
3. 打开 Amadeus 应用 → 设置 → 语音合成 → 阿里云百炼
4. 填入阿里云 API Key，点「保存」
5. 点「**一键克隆**」按钮（自动用内置的 `voice_sample.mp3` 克隆红莉栖音色到你的账号，约 5-15 秒）
6. 克隆成功后引擎会自动切到 Qwen3-TTS-VC，直接去聊天就能听到红莉栖说话了

> 一键克隆用的是 Qwen3-TTS-VC 引擎（支持 base64 上传音频，无需公网 URL）。
> 如果想用 CosyVoice 引擎（音质更好），需要自行到阿里云控制台手动克隆（CosyVoice 要求音频公网 URL），然后把音色 ID 填到设置里。

### MiniMax

1. 注册 MiniMax 账号：https://www.minimaxi.com/
2. 进入控制台 → 「声音复刻」
3. 上传 `public/voice_sample.mp3` 克隆
4. 得到音色 ID 后填入设置

## 常见问题

### Q: 启动后页面空白？
A: 检查浏览器控制台是否有错误，通常是 API Key 未配置或模型文件缺失。

### Q: TTS 没有声音？
A: 检查 TTS 配置中的 API Key 是否正确，以及浏览器是否允许自动播放音频。

### Q: 一键克隆失败？
A: 常见原因：1) API Key 未填或无效；2) 阿里云账号未实名认证；3) 声音复刻服务未开通。请看克隆按钮下方的错误提示。可点「清除标记」后重试。

### Q: TTS 报错「音色不存在」或「voice not found」？
A: 如果用 CosyVoice 引擎，音色 ID 绑定个人账号，需要自行克隆。推荐用「一键克隆」功能（自动用 Qwen3-TTS-VC 引擎）。

### Q: Live2D 模型不显示？
A: 确保 `public/live2d/` 目录下有完整的模型文件。

## 相关项目

- [Live2D Cubism SDK](https://www.live2d.com/learn/sample/)
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

- Live2D 模型资源来自开源社区
- 感谢 [handsome90415/kurisu-live2d-runtime](https://github.com/handsome90415/kurisu-live2d-runtime) 项目的参考
- 感谢所有开源贡献者
