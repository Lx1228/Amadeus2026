/**
 * 口癖原声（整句匹配）
 * ====================
 * 真由理的「トゥットゥルー♪」（嘟嘟噜）用克隆模型念出来不像原作。
 * 2026-10-18 用户定案：**不拼接**（拼接怎么调都不自然），改成两条路径——
 *
 *   1. 开场白：新开会话的第一句，整句就是原声（5 条按时段挑）
 *   2. 口头禅：用户问"你的口头禅是什么"时，单独播一声原声（5 条随机）
 *
 * 共同点：**播的整段都是原声**，不存在"原声 + 合成"拼在一起的接缝。
 * 因此这里只做「整句匹配 → 返回原声地址」，命中不了就交给合成（日常对话不会命中，
 * 因为人设已禁止她在日常回复里说嘟嘟噜）。
 *
 * 与 voice-clips.ts 的区别：那边是红莉栖的"整句+关键词"触发；这边是角色口癖原声，
 * 按角色隔离，且支持"一句话对应多个录音"（随机播一条，避免每次一模一样）。
 */

/** 单条口癖原声 */
export interface Catchphrase {
  /** 唯一标识（调试用） */
  id: string;
  /** 只对这个角色生效 */
  characterId: string;
  /** 可接受的台词写法（内部会归一化后比较，促音/长音/小写假名/标点都不敏感） */
  matches: string[];
  /** public/clips/ 下的文件名；多条则随机播一条 */
  files: string[];
  /** 中文说明，仅用于调试 */
  note: string;
}

/**
 * 口癖库。
 *
 * 用函数而非顶层数组：Turbopack 会把多个模块合并进同一 chunk，
 * 顶层 const 可能被排到引用点之后触发 TDZ（同 voice-clips.ts 的教训）。
 */
export function getCatchphrases(): Catchphrase[] {
  return [
    // === 开场白（新开会话第一句，整句原声）===
    {
      id: "may-open-ohayo",
      characterId: "may",
      matches: ["トゥットゥルー♪ おはよう！"],
      files: ["may-open-ohayo.wav"],
      note: "早上开场：嘟嘟噜～ 早上好",
    },
    {
      id: "may-open-mayushii-a",
      characterId: "may",
      matches: ["トゥットゥルー♪ まゆしぃです！"],
      files: ["may-open-mayushii-a.wav", "may-open-mayushii-b.wav"],
      note: "白天开场：嘟嘟噜～ 我是真由氏（两个录音随机）",
    },
    {
      id: "may-open-okaeri",
      characterId: "may",
      matches: ["トゥットゥルー♪ おかえり！"],
      files: ["may-open-okaeri.wav"],
      note: "晚间开场：嘟嘟噜～ 你回来啦",
    },
    {
      id: "may-open-tadaima",
      characterId: "may",
      matches: ["トゥットゥルー♪ ただいま！"],
      files: ["may-open-tadaima.wav"],
      note: "深夜开场：嘟嘟噜～ 我回来了",
    },
    // === 纯口癖（回答"你的口头禅是什么"，五条随机）===
    {
      id: "may-tutturu",
      characterId: "may",
      matches: ["トゥットゥルー♪"],
      files: [
        "may-tutturu-1.wav",
        "may-tutturu-2.wav",
        "may-tutturu-3.wav",
        "may-tutturu-4.wav",
        "may-tutturu-5.wav",
      ],
      note: "单独一声嘟嘟噜（五个录音随机）",
    },
  ];
}

/** 单个原声的公开访问路径 */
export function catchphraseUrl(file: string): string {
  return `/clips/${file}`;
}

/**
 * 文本归一化：把各种写法压成同一个比较键。
 * - 全角/半角统一（NFKC）
 * - 片假名 → 平假名（トゥットゥルー / とぅっとぅるー 都能对上）
 * - 小写假名 → 大写（まゆしぃ → まゆしい）
 * - 去掉促音、长音符、标点、空白、音符符号
 */
function normalizeCatch(text: string): string {
  const SMALL: Record<string, string> = {
    ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お",
    っ: "", ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ",
  };
  return text
    .normalize("NFKC")
    .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ぁぃぅぇぉっゃゅょゎ]/g, (c) => SMALL[c] ?? c)
    .replace(/[ー〜～~\-－―]/g, "")
    .replace(/[。、！？!?.,…・：；「」『』（）()♪♫\s]/g, "");
}

/** 纯口癖的归一化键（兜底判定用） */
const TUTTURU_KEY = normalizeCatch("トゥットゥルー");

/**
 * 整句匹配口癖原声。
 *
 * @param characterId 当前角色
 * @param text 已清洗的日语文本
 * @returns 命中的口癖；没命中返回 null（调用方回退到合成）
 */
export function matchCatchphrase(characterId: string, text: string): Catchphrase | null {
  if (!text) return null;
  const norm = normalizeCatch(text);
  if (!norm) return null;

  const all = getCatchphrases();

  // 1) 整句精确匹配（开场白走这里）
  for (const c of all) {
    if (c.characterId !== characterId) continue;
    if (c.matches.some((m) => normalizeCatch(m) === norm)) return c;
  }

  // 2) 兜底：以嘟嘟噜开头且很短 —— LLM 偶尔会接一句解释
  //    （「トゥットゥルーだよ」）。这时宁可只放一声原声，也不要让模型把嘟嘟噜念出来。
  //    ⚠️ 必须限定在同一角色下找，否则别的角色说这句也会被换成真由理的原声。
  if (norm.startsWith(TUTTURU_KEY) && norm.length <= TUTTURU_KEY.length + 12) {
    return (
      all.find(
        (c) =>
          c.characterId === characterId &&
          c.matches.some((m) => normalizeCatch(m) === TUTTURU_KEY)
      ) ?? null
    );
  }

  return null;
}

/** 从命中的口癖里随机取一条音频地址（多录音时避免每次都一样） */
export function pickCatchphraseUrl(clip: Catchphrase): string {
  const file = clip.files[Math.floor(Math.random() * clip.files.length)];
  return catchphraseUrl(file);
}
