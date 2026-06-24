/**
 * 会话级登录态（内存变量，不持久化）
 *
 * 设计：登录态只存在当前 SPA 会话的内存中。
 * - 客户端路由跳转（router.push/replace）时保留
 * - 刷新页面 / 新开标签页时丢失 → 自动回到登录页
 *
 * 这正是"刷新即需重新登录"的语义。
 * 不用 localStorage，因为 localStorage 会跨刷新保留，不符合需求。
 */

let sessionLoggedIn = false;

export function isSessionLoggedIn(): boolean {
  return sessionLoggedIn;
}

export function setSessionLoggedIn(value: boolean): void {
  sessionLoggedIn = value;
}
