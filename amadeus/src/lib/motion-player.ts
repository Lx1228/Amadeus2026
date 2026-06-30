/**
 * 自定义 Motion 播放器
 * 绕过 pixi-live2d-display 的 motion 解析器（它对未定义参数会崩溃）
 * 直接解析 motion3.json 并驱动模型参数
 */

interface MotionPoint {
  time: number;
  value: number;
}

interface MotionCurve {
  target: string;
  id: string;
  points: MotionPoint[];
}

interface MotionData {
  duration: number;
  loop: boolean;
  curves: MotionCurve[];
}

interface CoreModel {
  setParameterValueById: (id: string, value: number) => void;
}

/**
 * 解析 motion3.json 的 Segments 数组为关键帧点序列
 */
function parseSegments(segments: number[]): MotionPoint[] {
  const points: MotionPoint[] = [];
  let i = 0;

  // 第一个点
  if (segments.length < 2) return points;
  const startTime = segments[0];
  const startValue = segments[1];
  points.push({ time: startTime, value: startValue });
  i = 2;

  while (i < segments.length) {
    const type = segments[i];
    i++;

    switch (type) {
      case 0: { // Linear
        if (i + 1 >= segments.length) return points;
        const time = segments[i];
        const value = segments[i + 1];
        points.push({ time, value });
        i += 2;
        break;
      }
      case 1: { // Bezier
        if (i + 5 >= segments.length) return points;
        // cx1, cy1, cx2, cy2, time, value
        const time = segments[i + 4];
        const value = segments[i + 5];
        points.push({ time, value });
        i += 6;
        break;
      }
      case 2: { // Stepped
        if (i + 1 >= segments.length) return points;
        const time = segments[i];
        const value = segments[i + 1];
        points.push({ time, value, });
        i += 2;
        break;
      }
      case 3: { // Inverse Stepped
        if (i + 1 >= segments.length) return points;
        const time = segments[i];
        const value = segments[i + 1];
        points.push({ time, value });
        i += 2;
        break;
      }
      default:
        // 未知类型，跳过
        console.warn("[MotionPlayer] 未知 segment 类型:", type);
        return points;
    }
  }

  return points;
}

/**
 * 在关键帧点之间线性插值
 */
function interpolatePoints(points: MotionPoint[], time: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].value;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;

  // 找到包含当前时间的区间
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (time >= p0.time && time <= p1.time) {
      const t = (time - p0.time) / (p1.time - p0.time);
      return p0.value + (p1.value - p0.value) * t;
    }
  }

  return points[points.length - 1].value;
}

/**
 * 解析 motion3.json 文件为 MotionData
 */
export function parseMotionJson(json: unknown): MotionData {
  const data = json as {
    Meta: { Duration: number; Loop: boolean };
    Curves: Array<{ Target: string; Id: string; Segments: number[] }>;
  };

  return {
    duration: data.Meta.Duration,
    loop: data.Meta.Loop,
    curves: data.Curves
      .filter((c) => c.Target === "Parameter") // 只处理 Parameter 类型的曲线
      .map((c) => ({
        target: c.Target,
        id: c.Id,
        points: parseSegments(c.Segments),
      }))
      .filter((c) => c.points.length > 0),
  };
}

export class MotionPlayer {
  private currentMotion: MotionData | null = null;
  private startTime: number = 0;
  private isPlaying: boolean = false;
  private loop: boolean = false;
  private onComplete: (() => void) | null = null;

  /**
   * 加载并播放 motion 文件
   */
  async play(url: string, coreModel: CoreModel, loop: boolean = false): Promise<void> {
    try {
      console.log(`[MotionPlayer] 开始加载: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        console.error("[MotionPlayer] HTTP 错误:", url, response.status);
        return;
      }
      const json = await response.json();
      this.currentMotion = parseMotionJson(json);
      this.loop = loop;
      this.startTime = performance.now() / 1000;
      this.isPlaying = true;

      console.log(`[MotionPlayer] ✅ 播放成功: ${url}, 曲线数: ${this.currentMotion.curves.length}, 时长: ${this.currentMotion.duration}s, 循环: ${loop}`);
    } catch (e) {
      console.error("[MotionPlayer] ❌ 解析失败:", url, e);
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.isPlaying = false;
    this.currentMotion = null;
  }

  /**
   * 设置完成回调
   */
  setOnComplete(callback: () => void): void {
    this.onComplete = callback;
  }

  /**
   * 每帧更新：将 motion 数据应用到模型参数
   * 返回是否仍在播放
   */
  update(coreModel: CoreModel): boolean {
    if (!this.isPlaying || !this.currentMotion) return false;

    const now = performance.now() / 1000;
    let elapsed = now - this.startTime;

    if (elapsed >= this.currentMotion.duration) {
      if (this.loop) {
        // 循环：重置开始时间
        this.startTime = now;
        elapsed = 0;
      } else {
        // 不循环：停止
        this.isPlaying = false;
        if (this.onComplete) this.onComplete();
        return false;
      }
    }

    // 应用每个曲线的插值到模型参数
    for (const curve of this.currentMotion.curves) {
      const value = interpolatePoints(curve.points, elapsed);
      try {
        coreModel.setParameterValueById(curve.id, value);
      } catch {
        // 忽略不存在的参数
      }
    }

    return true;
  }

  get playing(): boolean {
    return this.isPlaying;
  }
}
