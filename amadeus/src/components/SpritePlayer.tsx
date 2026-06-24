"use client";

import { useEffect, useRef } from "react";

interface SpritePlayerProps {
  src: string;
  rows: number;
  columns: number;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  loop?: number;
  className?: string;
  style?: React.CSSProperties;
  displayWidth?: number;
  displayHeight?: number;
}

export default function SpritePlayer({
  src,
  rows,
  columns,
  fps,
  width,
  height,
  totalFrames,
  loop = 0,
  className = "",
  style = {},
  displayWidth,
  displayHeight,
}: SpritePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      const frameW = img.width / columns;
      const frameH = img.height / rows;

      canvas.width = frameW;
      canvas.height = frameH;

      const interval = 1000 / fps;
      let lastTime = 0;

      const animate = (time: number) => {
        if (time - lastTime >= interval) {
          lastTime = time;

          const frameX = frameRef.current % columns;
          const frameY = Math.floor(frameRef.current / columns);

          ctx.clearRect(0, 0, frameW, frameH);
          ctx.drawImage(
            img,
            frameX * frameW,
            frameY * frameH,
            frameW,
            frameH,
            0,
            0,
            frameW,
            frameH
          );

          frameRef.current++;
          if (frameRef.current >= totalFrames) {
            if (loop === 0) {
              frameRef.current = 0;
            } else {
              frameRef.current = totalFrames - 1; // 定格在最后一帧
            }
          }
        }
        animRef.current = requestAnimationFrame(animate);
      };

      animRef.current = requestAnimationFrame(animate);
    };

    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [src, fps, totalFrames, loop, columns, rows]);

  const canvasStyle: React.CSSProperties = {
    ...style,
    ...(displayWidth ? { width: `${displayWidth}px` } : {}),
    ...(displayHeight ? { height: `${displayHeight}px` } : {}),
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={canvasStyle}
    />
  );
}
