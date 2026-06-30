/**
 * Tauri 打包前置脚本：组装 standalone 运行时目录
 *
 * 流程：
 * 1. next build（已由 beforeBuildCommand 触发，本脚本不重复执行）
 * 2. 复制 .next/static → standalone/.next/static（Next.js standalone 不自动复制）
 * 3. 复制 public/* → standalone/public（standalone 只复制部分文件）
 * 4. 下载/复制 Windows Node.js 二进制到 standalone/node.exe
 * 5. 写一个启动脚本 standalone/start.js，设置 PORT=3456 避免冲突
 *
 * 最终 standalone 目录结构（Tauri 打包时会整个塞进安装包）：
 * standalone/
 * ├── amadeus/
 * │   ├── server.js        (Next.js 服务器入口)
 * │   ├── .next/           (构建产物 + static)
 * │   ├── node_modules/    (精简依赖)
 * │   ├── public/          (静态资源：Live2D、音色样本等)
 * │   └── package.json
 * ├── node.exe             (Node.js 运行时，~40MB)
 * └── start.js             (启动脚本，设端口)
 *
 * 运行时 Rust 代码执行：node.exe start.js → 启动 Next.js server → localhost:3456
 */
import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const nextBuildDir = join(projectRoot, ".next");
const standaloneRoot = join(nextBuildDir, "standalone");
const standaloneApp = join(standaloneRoot, "amadeus");
const publicDir = join(projectRoot, "public");

// Next.js server 端口（避开常用端口 3000，防止和开发环境冲突）
const SERVER_PORT = 3456;

console.log("[build-for-tauri] 开始组装 standalone 目录...");

// 1. 检查 standalone 是否存在
if (!existsSync(standaloneApp)) {
  console.error("[build-for-tauri] 错误：standalone 目录不存在，请先执行 next build");
  process.exit(1);
}

// 2. 复制 .next/static → standalone/amadeus/.next/static
const staticSrc = join(nextBuildDir, "static");
const staticDst = join(standaloneApp, ".next", "static");
if (existsSync(staticSrc)) {
  console.log("[build-for-tauri] 复制 .next/static...");
  cpSync(staticSrc, staticDst, { recursive: true });
}

// 3. 复制 public/* → standalone/amadeus/public（standalone 只复制了部分）
if (existsSync(publicDir)) {
  console.log("[build-for-tauri] 复制 public...");
  cpSync(publicDir, join(standaloneApp, "public"), { recursive: true });
}

// 4. 下载 Windows Node.js 二进制（如果本地没有）
const nodeExePath = join(standaloneRoot, "node.exe");
if (!existsSync(nodeExePath)) {
  console.log("[build-for-tauri] 寻找可用的 node.exe...");

  // 优先用系统已安装的 Node.js（从 PATH 找）
  let systemNode = "";
  try {
    systemNode = execSync("where node", { encoding: "utf-8" }).trim().split("\n")[0].trim();
  } catch {
    // PATH 里没有
  }

  // 优先用 WorkBuddy 管理的 Node.js
  const workbuddyNode = "C:/Users/Fry/.workbuddy/binaries/node/versions/22.12.0/node.exe";
  const candidates = [workbuddyNode, systemNode].filter(p => p && existsSync(p));

  if (candidates.length > 0) {
    console.log(`[build-for-tauri] 复制 node.exe from: ${candidates[0]}`);
    cpSync(candidates[0], nodeExePath);
    console.log(`[build-for-tauri] node.exe 已复制 (${(statSync(nodeExePath).size / 1024 / 1024).toFixed(1)}MB)`);
  } else {
    console.error("[build-for-tauri] 错误：找不到 node.exe，请确保 Node.js 已安装");
    process.exit(1);
  }
}

// 5. 写启动脚本 start.js（设置端口 + 启动 server.js）
const startJs = `
// Tauri sidecar 启动脚本
// 设置端口为 ${SERVER_PORT}，然后加载 Next.js standalone server
process.env.PORT = "${SERVER_PORT}";
process.env.HOSTNAME = "127.0.0.1";
process.env.NODE_ENV = "production";
require("./amadeus/server.js");
`.trim();

writeFileSync(join(standaloneRoot, "start.js"), startJs);
console.log(`[build-for-tauri] start.js 已写入（端口 ${SERVER_PORT}）`);

// 6. 写一个版本信息文件（供 Rust 代码读取端口）
const info = {
  port: SERVER_PORT,
  host: "127.0.0.1",
  url: `http://127.0.0.1:${SERVER_PORT}`,
  startScript: "start.js",
  nodeExe: "node.exe",
  appDir: "amadeus",
};
writeFileSync(join(standaloneRoot, "sidecar-info.json"), JSON.stringify(info, null, 2));

console.log("[build-for-tauri] standalone 目录组装完成！");
console.log(`[build-for-tauri] 目录: ${standaloneRoot}`);
console.log(`[build-for-tauri] 服务地址: ${info.url}`);
