/**
 * 调试日志
 * ========
 * 程序在打包成桌面 app 后，用户看不到浏览器 F12 控制台，
 * 但开发排障时（白屏、不出声、Live2D 不加载）这些日志是关键线索。
 *
 * 所以不做「删掉」，而是「只在开发时输出」：
 *   - 开发模式（next dev / 本地调试）：正常打印
 *   - 生产模式（next build 后的正式版）：静默，不打印、不占性能
 *
 * 用法：把原来的 console.log("[xxx] ...", a) 换成 log("[xxx] ...", a)
 *      console.error / console.warn 不动（那是真实的错误处理，必须保留）
 */

/** 是否处于开发模式（Next.js 会在构建时把这个常量内联成 false） */
const isDev = process.env.NODE_ENV !== "production";

/** 开发模式下的调试日志 */
export function log(...args: unknown[]): void {
  if (isDev) {
    console.log(...args);
  }
}

/** 带标签的日志：logInfo("TTS", "合成耗时", 120, "ms") */
export function logInfo(tag: string, ...args: unknown[]): void {
  if (isDev) {
    console.log(`[${tag}]`, ...args);
  }
}
