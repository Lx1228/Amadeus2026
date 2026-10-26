import type { NextConfig } from "next";

/**
 * 语音引擎目录（Python 环境 + 约 19GB 模型）绝对不能进构建产物。
 *
 * 背景（2026-10-12 踩坑记录）：
 *   tts-local 和本项目同级（E:\Amadeus\tts-local），Next 的文件追踪会把它
 *   当成项目资源扫进 standalone —— 实测 11GB，把 E 盘 77G 撑爆
 *   （cp 报 "No space left on device"）。
 *
 * 为什么这里不写 outputFileTracingExcludes：
 *   1. 相对路径（"./tts-local/..."）无效 —— E:\Amadeus 下有 package.json，
 *      Next 把 workspace root 认成了 E:\Amadeus 而不是 E:\Amadeus\amadeus
 *   2. 绝对路径在 Turbopack 下也不认
 *   3. 任何带 ".." 的 glob 会被 Turbopack 直接拒绝
 *      （报 "has a prefix that navigates out of the project root"）
 *
 * 真正的解法在 scripts/build-for-tauri.mjs：那里无条件删掉产物里的 tts-local，
 * 属于硬清理兜底，比配置可靠。改这里不如改那边。
 */
const nextConfig: NextConfig = {
  // standalone 模式：next build 生成 .next/standalone 目录，
  // 包含可独立运行的 server.js + 精简的 node_modules（只含实际用到的依赖）。
  // Tauri 打包时把这个目录 + node.exe + public 一起塞进安装包，
  // 运行时由 Tauri 静默启动 node server.js，用户只看到一个应用窗口。
  output: "standalone",

  // 减小产物体积：不在产物里生成 source map
  productionBrowserSourceMaps: false,
};

export default nextConfig;
