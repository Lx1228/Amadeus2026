"""生成「真由理口头禅原声」素材（音频资产构建脚本，一次性运行）

来源：HuggingFace `SteinsGateSg/mayuri-voice-dataset`（SG0 真由理语音，16kHz）
原始文件下载在 `E:\\Amadeus\\_tutturu_cand\\`（MAY_0137 / 0224 / 0835 / 1511 / 0748）

产出到 amadeus/public/clips/：
  开场白（整句原声，按时段挑一条播）
    may-open-ohayo.wav        トゥットゥルー おはよう
    may-open-mayushii-a.wav   トゥットゥルー まゆしぃです（版本 A）
    may-open-mayushii-b.wav   トゥットゥルー まゆしぃです（版本 B）
    may-open-okaeri.wav       トゥットゥルー おかえり
    may-open-tadaima.wav      トゥットゥルー ただいま
  纯口癖（回答"你的口头禅是什么"时随机播一条）
    may-tutturu-1..5.wav      同一句的五个录音（裁自上面五条的头部）

统一处理：24kHz mono 16bit、去首尾静音、有声段 RMS 归一到 0.19（与合成输出一致）
"""
import os

import librosa
import numpy as np
import soundfile as sf

SRC = r"E:\Amadeus\_tutturu_cand"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "clips")
OUT = os.path.abspath(OUT)
SR = 24000
TARGET_RMS = 0.19

OPENS = [
    ("MAY_0137", "may-open-ohayo.wav", 2.58),
    ("MAY_0224", "may-open-mayushii-a.wav", 2.52),
    ("MAY_0835", "may-open-mayushii-b.wav", 2.99),
    ("MAY_1511", "may-open-okaeri.wav", 2.86),
    ("MAY_0748", "may-open-tadaima.wav", 3.20),
]
TUTTURU = ["MAY_0137", "MAY_0224", "MAY_0835", "MAY_1511", "MAY_0748"]


def trim_silence(w, head=0.06, tail=0.22, th_ratio=0.03):
    env = np.abs(w)
    th = env.max() * th_ratio
    idx = np.where(env > th)[0]
    if len(idx) == 0:
        return w
    a = max(0, idx[0] - int(head * SR))
    b = min(len(w), idx[-1] + int(tail * SR))
    return w[a:b]


def normalize(w):
    fr = np.abs(w)
    mask = fr > fr.max() * 0.1
    cur = float(np.sqrt((w[mask] ** 2).mean())) if mask.any() else 0.0
    if cur > 1e-4:
        w = w * (TARGET_RMS / cur)
    peak = float(np.abs(w).max())
    if peak > 0.92:
        w = w * (0.92 / peak)
    n = int(SR * 0.012)
    if len(w) > 2 * n:
        w[:n] *= np.linspace(0, 1, n)
        w[-n:] *= np.linspace(1, 0, n)
    return w


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f"输出目录: {OUT}\n")

    for sid, name, expect in OPENS:
        p = os.path.join(SRC, f"{sid}.wav")
        w, _ = librosa.load(p, sr=SR, mono=True)
        w = normalize(trim_silence(w.astype(np.float32)))
        sf.write(os.path.join(OUT, name), w, SR, subtype="PCM_16")
        print(f"{name:<26}{len(w)/SR:>5.2f}s (原 {expect:.2f}s)")

    for i, sid in enumerate(TUTTURU, 1):
        name = f"may-tutturu-{i}.wav"
        p = os.path.join(SRC, "trim", f"{sid}_trim.wav")
        w, _ = librosa.load(p, sr=SR, mono=True)
        w = normalize(w.astype(np.float32))
        sf.write(os.path.join(OUT, name), w, SR, subtype="PCM_16")
        print(f"{name:<26}{len(w)/SR:>5.2f}s")


if __name__ == "__main__":
    main()
