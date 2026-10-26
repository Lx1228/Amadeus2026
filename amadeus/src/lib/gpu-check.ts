/**
 * 语音模型安装前的显卡预检（2026-10-18）。
 *
 * Qwen3-TTS 本地推理必须有 NVIDIA 显卡（CUDA），显存建议 6GB 以上。
 * 没有 N 卡 / 显存不够的机器：安装照样能下完 5GB 模型，但启动服务必然失败——
 * 所以在「点安装之前」就拦住，明确告诉用户"语音不可用，文字聊天正常"。
 *
 * ⚠️ 本模块只允许服务端引用（用了 child_process），不要 import 进客户端组件。
 */
import { execFile } from "child_process";

export interface GpuInfo {
  /** 显卡是否满足语音合成要求 */
  ok: boolean;
  /** 显卡型号（如 "NVIDIA GeForce RTX 4060 Ti"） */
  name?: string;
  /** 显存（MB） */
  vramMB?: number;
  /** 不满足时给用户看的中文提示 */
  reason?: string;
}

/** 语音合成的显存下限：6GB（Qwen3-TTS 1.7B bf16 + CUDA Graph 约占 4~5GB） */
const MIN_VRAM_MB = 6144;

let cached: GpuInfo | null = null;

/**
 * 查询 NVIDIA 显卡型号与显存（结果缓存，进程内只查一次）。
 * 用 nvidia-smi 而不是 torch：安装前 venv 里还没有 torch。
 */
export function getGpuInfo(): Promise<GpuInfo> {
  if (cached) return Promise.resolve(cached);

  return new Promise<GpuInfo>((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          cached = {
            ok: false,
            reason: "你的电脑没有 NVIDIA 显卡，语音功能不可用，仍可正常文字聊天",
          };
          resolve(cached);
          return;
        }
        // 输出形如 "NVIDIA GeForce RTX 4060 Ti, 8188"（多卡取第一行）
        const line = stdout.trim().split("\n")[0] || "";
        const [name, mem] = line.split(",").map((x) => x.trim());
        const vram = parseInt(mem, 10);
        if (!name || !Number.isFinite(vram) || vram <= 0) {
          cached = {
            ok: false,
            reason: "无法识别显卡信息，语音功能可能不可用，仍可正常文字聊天",
          };
          resolve(cached);
          return;
        }
        if (vram < MIN_VRAM_MB) {
          cached = {
            ok: false,
            name,
            vramMB: vram,
            reason: `显存不足（${name}，约 ${(vram / 1024).toFixed(1)}GB，需要 6GB 以上），语音功能不可用，仍可正常文字聊天`,
          };
          resolve(cached);
          return;
        }
        cached = { ok: true, name, vramMB: vram };
        resolve(cached);
      }
    );
  });
}
