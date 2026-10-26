"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * 舞台容器（2026-10-25 大改：不再由 JS 做整体缩放）
 *
 * 演进过程（都是踩过的坑，别倒退回去）：
 *   1. transform: scale  → 位图拉伸，文字发糊（用户："放大看字模糊"）
 *   2. CSS zoom          → 布局级缩放、文字清晰，但每次变化重排整页，
 *                          窗口切换时有一帧延迟（用户："还是闪"）
 *   3. flushSync + 藏帧  → 治标不治本，藏帧本身还制造了一帧黑
 *
 * 现在：**整体缩放交给 CSS 根字号**（见 app/layout.tsx 的 html fontSize = 100vw/80）。
 * Tailwind 的间距和字号全是 rem，根字号一变它们自动等比放大 ——
 * 这是浏览器原生布局，窗口 resize 时零 JS 介入，所以既不糊也不闪。
 *
 * 这个组件现在只剩两个职责：
 *   1. 铺满视口（stage 本身）
 *   2. 通过 ResizeObserver 把实际尺寸告诉需要像素值的组件（Live2D canvas）
 */

/** 设计基准宽度（根字号 16px 时对应的窗口宽度） */
export const STAGE_WIDTH = 1280;
/** 设计基准高度 */
export const STAGE_HEIGHT = 720;

/** 舞台尺寸与缩放比 */
export interface StageMetrics {
  width: number;
  height: number;
  /** 相对设计基准的放大倍数，供 canvas 类组件算渲染分辨率 */
  scale: number;
}

export default function ViewportScaler({ children }: { children: ReactNode }) {
  return (
    <div id="amadeus-stage" className="fixed inset-0 overflow-hidden">
      {children}
    </div>
  );
}

/**
 * 订阅舞台实际尺寸。
 * 只有尺寸真的变化时才触发一次重渲染（ResizeObserver 在布局后回调）。
 */
export function useStageMetrics(): StageMetrics {
  const [metrics, setMetrics] = useState<StageMetrics>({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    scale: 1,
  });

  useEffect(() => {
    const el = document.getElementById("amadeus-stage");
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const scale = r.width / STAGE_WIDTH;
      setMetrics((prev) => {
        // 尺寸没变就不 setState，避免无意义的重渲染
        if (
          Math.abs(prev.width - r.width) < 0.5 &&
          Math.abs(prev.height - r.height) < 0.5 &&
          Math.abs(prev.scale - scale) < 0.001
        ) {
          return prev;
        }
        return { width: r.width, height: r.height, scale };
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return metrics;
}

/** 只关心舞台高度时的便捷 hook */
export function useStageHeight(): number {
  return useStageMetrics().height;
}
