import type { Metadata } from "next";
import "./globals.css";
import ViewportScaler from "@/components/ViewportScaler";
import WindowBar from "@/components/WindowBar";

export const metadata: Metadata = {
  title: "Amadeus",
  description: "Amadeus — 数字伴侣",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
      // 2026-10-25：整个界面的等比缩放改成**根字号驱动**。
      //
      // 为什么不再用 zoom / transform：
      //   zoom 每次变化都要重排整页，窗口切换时有一帧延迟 → 闪；
      //   transform 是位图拉伸 → 字糊。
      //   两者都不行。
      //
      // 现在的做法：设计基准 1280 宽 → 1rem = 16px。根字号 = 视口宽 / 80，
      //   1280 宽 → 16px，1920 宽 → 24px。
      //   Tailwind 的间距（p-4 / w-4 …）和字号（text-sm …）**全部是 rem**，
      //   所以它们会自动等比放大；文字按真实字号渲染（清晰），
      //   窗口变化时是浏览器原生重排（不需要 JS 介入）→ 不闪。
      style={{ fontSize: "clamp(10px, calc(100vw / 80), 26px)" }}
    >
      <body className="h-full bg-black">
        {/* 整体缩放已交给根字号，这里只做铺满 + 提供尺寸信息 */}
        <ViewportScaler>
          {/* 2026-10-25：窗口无边框了，标题栏的拖动条 + 最小化 / 关闭按钮自绘 */}
          <WindowBar />
          {children}
        </ViewportScaler>
      </body>
    </html>
  );
}
