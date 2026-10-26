/**
 * 模型提供商配置与迁移
 * ====================
 * 独立成文件的原因（2026-10-11）：
 * 这段代码原先放在 Settings.tsx 里，Turbopack 打包时把顶层 const PROVIDERS
 * 排到了引用点之后，模块初始化时抛
 *   ReferenceError: Cannot access 'X' before initialization
 * 导致整页加载失败（WebView 显示 This page couldn't load）。
 * 拆到独立模块后不再和其他组件的状态混在同一个 chunk，规避打包器的 TDZ 优化问题。
 */

export interface ModelConfig {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface ProviderInfo {
  name: string;
  endpoints: string[];
  models: string[];
}

const STORAGE_KEY = "amadeus_model_config";

/** 用函数包一层，避免顶层 const 的初始化顺序问题 */
export function getProviders(): Record<string, ProviderInfo> {
  return {
    xiaomi: {
      name: "小米 MiMo",
      endpoints: [
        "https://api.xiaomimimo.com/v1",
        "https://token-plan-cn.xiaomimimo.com/v1",
      ],
      models: ["mimo-v2.6-pro"],
    },
    deepseek: {
      // 2026-10-18 依据官方更新日志（api-docs.deepseek.com/zh-cn/updates）：
      // - deepseek-flash 已升级为 DeepSeek-V4.1-Flash-1017（2026-10-17 发布），调用方式不变
      // - deepseek-v4-pro 已于 2026-09-14 起全部路由到 V4.1 Flash，V4.1 Pro 上线前不恢复
      // - V4.1 Flash 原生多模态（支持图片输入），App 的图片消息格式（image_url）可直接使用
      name: "DeepSeek",
      endpoints: ["https://api.deepseek.com/v1"],
      models: ["deepseek-flash"],
    },
    custom: {
      // 2026-10-25 用户要求接回「自定义接口」：endpoint / model 全部由用户手填，
      // 这里刻意留空数组 —— 设置页检测到 provider === "custom" 时改渲染输入框，
      // 而不是下拉选项（空数组直接 map 会渲染出空下拉框）。
      name: "自定义",
      endpoints: [],
      models: [],
    },
  };
}

/** 是否为自定义接口（endpoint / model 由用户手填） */
export function isCustomProvider(provider: string): boolean {
  return provider === "custom";
}

/**
 * 规范化用户手填的接口地址：去首尾空白 + 去掉末尾斜杠。
 * 请求处是 `${endpoint}/chat/completions` 直接拼字符串，
 * 用户填成 "https://x/v1/" 时会拼出 "//chat/completions"，部分服务端会 404。
 */
export function normalizeEndpoint(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

// === 自定义接口的独立记忆（2026-10-25）===
// 切换提供商时会重置 config.endpoint / config.model，如果用户从自定义切到小米
// 再切回来，手填的地址就丢了。所以单独存一份，切回自定义时恢复。
// 另一个作用：避免把上一家的地址预填到自定义输入框里，
// 让人误以为"系统自动帮我选了小米"（2026-10-25 用户反馈的困惑）。

const CUSTOM_ENDPOINT_KEY = "amadeus_custom_endpoint";
const CUSTOM_MODEL_KEY = "amadeus_custom_model";

export function loadCustomEndpoint(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CUSTOM_ENDPOINT_KEY) || "";
}

export function saveCustomEndpoint(value: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_ENDPOINT_KEY, value);
}

export function loadCustomModel(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CUSTOM_MODEL_KEY) || "";
}

export function saveCustomModel(value: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_MODEL_KEY, value);
}

// === API Key 按提供商独立存储（2026-10-25）===
// 以前切换提供商时 apiKey 是沿用同一个值。风险很实在：用户切到自定义接口，
// 如果忘了改 key，就会**把小米的 key 发给第三方服务器**。
// 现在每个提供商各存一个槽，切换时自动换成对应那个（没填过就是空）。

function keySlot(provider: string): string {
  return `amadeus_key_${provider}`;
}

export function loadKeyForProvider(provider: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(keySlot(provider)) || "";
}

export function saveKeyForProvider(provider: string, apiKey: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(keySlot(provider), apiKey);
}

function defaultModelConfig(): ModelConfig {
  const p = getProviders().xiaomi;
  return { provider: "xiaomi", endpoint: p.endpoints[0], apiKey: "", model: p.models[0] };
}

export function loadModelConfig(): ModelConfig {
  if (typeof window === "undefined") return defaultModelConfig();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultModelConfig();

  try {
    const providers = getProviders();
    const config = JSON.parse(saved) as ModelConfig;
    const migrated = { ...config };

    // 老版本只有一个共享 apiKey，迁到当前提供商独立的槽里（2026-10-25）。
    // 刻意只迁内置提供商 —— 历史数据里「custom 沿用了别家 key」无法区分，
    // 强行迁移会把别家的 key 记到自定义槽，等于埋一个泄露隐患。
    if (config.apiKey && config.provider !== "custom") {
      const slot = `amadeus_key_${config.provider}`;
      if (!localStorage.getItem(slot)) localStorage.setItem(slot, config.apiKey);
    }

    // 2026-10-18：设置页去掉了"自定义"提供商。历史选过自定义的配置
    // （provider 已不存在）统一迁回小米默认，避免下拉框空白、endpoint 失效。
    if (!providers[config.provider]) {
      const x = providers.xiaomi;
      const fallback: ModelConfig = {
        provider: "xiaomi",
        endpoint: x.endpoints[0],
        apiKey: config.apiKey || "",
        model: x.models[0],
      };
      saveModelConfig(fallback);
      return fallback;
    }

    // 2026-10-25：自定义接口（provider === "custom"）原样返回。
    // 下面的模型名校验只针对内置提供商 —— 否则用户手填的模型名会被覆盖成默认值。
    if (config.provider === "custom") {
      const ep = normalizeEndpoint(migrated.endpoint);
      if (ep !== migrated.endpoint) {
        migrated.endpoint = ep;
      }
      // apiKey 只认「自定义槽」里的值，绝不回退到 config.apiKey。
      // 原因：老版本所有提供商共用一个 key，config.apiKey 里可能是小米的 key；
      // 如果回填进来，用户会看到"自定义接口里莫名其妙填了个 key"，
      // 更糟的是这个 key 会被发给第三方服务器。
      const ownKey = localStorage.getItem(`amadeus_key_custom`) || "";
      if (migrated.apiKey !== ownKey) {
        migrated.apiKey = ownKey;
      }
      if (ep !== config.endpoint || migrated.apiKey !== config.apiKey) {
        saveModelConfig(migrated);
      }
      return migrated;
    }

    // 小米：mimo-v2.5 / mimo-v2.5-pro 已于 2026-10-21 下线，统一迁到 mimo-v2.6-pro
    if (config.provider === "xiaomi" && !providers.xiaomi.models.includes(config.model)) {
      migrated.model = providers.xiaomi.models[0];
      saveModelConfig(migrated);
      return migrated;
    }

    // DeepSeek：deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用，
    // deepseek-v4-flash 也已由 V4.1-Flash 接管，统一迁到现行模型名
    if (config.provider === "deepseek") {
      // 2026-10-18：V4 Pro 已下线（请求全部路由到 V4.1 Flash），连同旧模型名一起
      // 迁到 deepseek-flash —— 否则下拉框会显示一个已不存在的选项
      if (
        config.model === "deepseek-chat" ||
        config.model === "deepseek-reasoner" ||
        config.model === "deepseek-v4-pro" ||
        config.model === "deepseek-v4-flash" ||
        config.model === "deepseek-v4-flash-vision-exp"
      ) {
        migrated.model = "deepseek-flash";
        saveModelConfig(migrated);
        return migrated;
      }
      return migrated;
    }

    return migrated;
  } catch {
    return defaultModelConfig();
  }
}

export function saveModelConfig(config: ModelConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}