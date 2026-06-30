import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // standalone 模式：next build 生成 .next/standalone 目录，
  // 包含可独立运行的 server.js + 精简的 node_modules（只含实际用到的依赖）。
  // Tauri 打包时把这个目录 + node.exe + public 一起塞进安装包，
  // 运行时由 Tauri 静默启动 node server.js，用户只看到一个应用窗口。
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
