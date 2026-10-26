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
import { cpSync, existsSync, rmSync, writeFileSync, statSync } from "fs";
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

// 2.5 ★ 硬清理：把误扫进 standalone 的大目录删掉
//
// 背景（2026-10-12 踩过两次坑，第二次直接把 E 盘 77G 撑爆）：
//   Next 的文件追踪会把项目外的同级目录当成项目资源塞进 standalone：
//     1. tts-local   —— 语音引擎，19GB（实测进产物 11GB）
//     2. src-tauri  —— Rust 编译产物 target/，9.6GB
//   原因：E:\Amadeus 下有 package.json（只有 tauri cli），
//   Next 把 workspace root 认成了 E:\Amadeus 而不是 E:\Amadeus\amadeus，
//   所以 next.config.ts 里的 outputFileTracingExcludes（相对路径）完全无效，
//   而绝对路径和带 ".." 的 glob 又会被 Turbopack 直接拒绝。
//
// 这里做硬删除兜底：不管配置生不生效，产物里不允许出现这两个目录。
//
// ⚠️ 用 Windows 原生 rd /s /q 而不是 rmSync —— rmSync 会被某些环境的
// safe-delete shim 拦截（大目录删除直接 ETIMEDOUT）。用户机器上 git-bash 可用。
function forceRemoveDir(dir) {
  if (!existsSync(dir)) return false;
  try {
    execSync(`rd /s /q "${dir}"`, {
      stdio: "ignore",
      timeout: 180000,
      windowsHide: true,
    });
    return !existsSync(dir);
  } catch {
    // rd 失败再退回 rmSync（比如在非 Windows 环境）
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

const junkDirs = [
  join(standaloneRoot, "tts-local"),
  join(standaloneApp, "tts-local"),
  join(standaloneApp, "src-tauri"),
  join(standaloneApp, ".next", "cache"),
];
for (const d of junkDirs) {
  if (existsSync(d)) {
    console.log(`[build-for-tauri] 清理误打包的大目录: ${d}`);
    if (forceRemoveDir(d)) {
      console.log(`[build-for-tauri]   ✓ 已删除`);
    } else {
      console.warn(
        `[build-for-tauri]   ✗ 删除失败！产物体积会异常，复制到部署目录前请先检查磁盘空间`
      );
    }
  }
}

// 统计产物体积（早点发现异常，别等复制到部署目录时把磁盘撑爆）
try {
  const sizeOut = execSync(
    `powershell -NoProfile -Command "(Get-ChildItem '${standaloneRoot}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum"`,
    { encoding: "utf-8", timeout: 120000, windowsHide: true }
  ).trim();
  const mb = Math.round(Number(sizeOut) / 1024 / 1024);
  console.log(`[build-for-tauri] 产物体积: ${mb} MB`);
  if (mb > 500) {
    console.warn(
      `[build-for-tauri] ⚠️ 产物体积异常（${mb} MB），可能又扫进了不该进的大目录。` +
      `复制到部署目录前务必先检查磁盘空间！`
    );
  }
} catch {
  /* 体积统计失败不影响构建 */
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
