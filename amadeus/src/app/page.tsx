"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Chat from "@/components/Chat";
import { isSessionLoggedIn } from "@/lib/auth";

/**
 * 主页守卫：检查内存会话登录态。
 * - 刷新页面 → 模块重新加载 → sessionLoggedIn 重置为 false → 跳 /login
 * - 登录成功后 router.push("/") → sessionLoggedIn 已设为 true → 渲染 Chat
 * - 客户端导航回主页 → 内存变量保留 → 不跳登录
 */
export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSessionLoggedIn()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;
  return <Chat />;
}
