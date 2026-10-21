// Bailian HTTP video-understanding catalog, checked 2026-10-21.
// Retired model IDs are blocked even in the custom field; no silent fallback.
export const CATALOG_DATE = '2026-10-21';
export const DEFAULT_MODEL = 'qwen3-vl-plus';
export const VIDEO_MODELS = Object.freeze([
  {
    "id": "qwen3.8-max",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.8-max-0902",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.8-flash",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.7-plus",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.7-plus-2026-05-26",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.7-flash",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.7-flash-2026-07-15",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.7-max-2026-06-08",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.6-plus",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.6-plus-2026-04-02",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.6-flash",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.6-flash-2026-04-16",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-plus",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-plus-2026-02-15",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-plus-2026-04-20",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-flash",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-flash-2026-02-23",
    "group": "千问 · 通用视觉",
    "thinking": false
  },
  {
    "id": "qwen3.8-27b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3.6-35b-a3b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3.6-27b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-397b-a17b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-122b-a10b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-27b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3.5-35b-a3b",
    "group": "千问 · 开源视觉",
    "thinking": false
  },
  {
    "id": "qwen3-vl-plus",
    "group": "千问 · VL",
    "thinking": false
  },
  {
    "id": "qwen3.8-omni-flash",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true
  },
  {
    "id": "qwen3.5-omni-plus",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true
  },
  {
    "id": "qwen3.5-omni-plus-2026-03-15",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true
  },
  {
    "id": "qwen3.5-omni-flash",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true
  },
  {
    "id": "qwen3.5-omni-flash-2026-03-15",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true
  },
  {
    "id": "qwen3-omni-flash",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true
  },
  {
    "id": "kimi-k2.6",
    "group": "Kimi",
    "thinking": false
  },
  {
    "id": "kimi-k2.5",
    "group": "Kimi",
    "thinking": false
  },
  {
    "id": "kimi-k2.7-code",
    "group": "Kimi · 思考",
    "thinking": true,
    "stream": true
  },
  {
    "id": "MiniMax/MiniMax-M3",
    "group": "MiniMax · 需在百炼开通",
    "minimax": true
  },
  {
    "id": "stepfun/step-3.7-flash",
    "group": "阶跃星辰 · 需在百炼开通",
    "thinking": false
  },
  {
    "id": "stepfun/step-5-preview",
    "group": "阶跃星辰 · 需在百炼开通",
    "thinking": false
  },
  {
    "id": "ZHIPU/GLM-5.3-Flash",
    "group": "智谱 · 需在百炼开通",
    "thinking": true,
    "stream": true,
    "source": "https://help.aliyun.com/zh/model-studio/glm-zhipu",
    "note": "原生视频及多张 Base64 image_url；仅思考，不能 enable_thinking:false。"
  },
  {
    "id": "ZHIPU/GLM-5.3-FlashX",
    "group": "智谱 · 需在百炼开通",
    "thinking": true,
    "stream": true,
    "source": "https://help.aliyun.com/zh/model-studio/glm-zhipu",
    "note": "原生视频及多张 Base64 image_url；仅思考，不能 enable_thinking:false。"
  },
  {
    "id": "xiaomi/mimo-v2.6-pro-ultraspeed",
    "group": "小米 · 需在百炼开通",
    "thinking": false,
    "source": "https://help.aliyun.com/zh/model-studio/mimo",
    "note": "原生图片/音频/视频；MiMo 混合推理可关闭；无需传 modalities/reasoning_effort。"
  },
  {
    "id": "kimi/kimi-k3",
    "group": "Kimi · 月之暗面直供",
    "thinking": true,
    "stream": true,
    "source": "https://help.aliyun.com/zh/model-studio/kimi-api-by-moonshot-ai",
    "note": "直供文档明确视频示例即此 ID；与无前缀 kimi-k3 部署能力不同，后者文档暂不支持视频。仅思考，不要传 false。"
  },
  {
    "id": "kimi/kimi-k2.7-code-highspeed",
    "group": "Kimi · 月之暗面直供",
    "thinking": true,
    "stream": true,
    "source": "https://help.aliyun.com/zh/model-studio/kimi-api-by-moonshot-ai",
    "note": "直供文档明确同系列输入文本/图像/视频；仅思考。"
  },
  {
    "id": "kimi/kimi-k2.7-code",
    "group": "Kimi · 月之暗面直供",
    "thinking": true,
    "stream": true,
    "source": "https://help.aliyun.com/zh/model-studio/kimi-api-by-moonshot-ai",
    "note": "直供文档明确同系列输入文本/图像/视频；仅思考。"
  },
  {
    "id": "kimi/kimi-k2.6",
    "group": "Kimi · 月之暗面直供",
    "thinking": false,
    "source": "https://help.aliyun.com/zh/model-studio/kimi-api-by-moonshot-ai",
    "note": "直供文档与上架日志明确文本/图像/视频；支持 enable_thinking:false。"
  },
  {
    "id": "qwen3.8-max-prime",
    "group": "千问 · 通用视觉",
    "thinking": false,
    "source": "https://help.aliyun.com/zh/model-studio/prime-mode",
    "note": "Prime 官方说明能力及限制与原版相同；北京可用，价格独立于标准版，勿按标准 Max 价格报价。"
  }
].map(Object.freeze));
export const TEXT_ONLY_MODELS = Object.freeze(['glm-5.3', 'deepseek-v4-pro-0813']);
// Official notices: 118177, 118178, 118434, 118344, 118345.
export const RETIRED_MODELS = Object.freeze([
  "qwen-vl-max",
  "qwen-vl-plus",
  "qvq-max",
  "qvq-plus",
  "qwen-omni-turbo",
  "qwen-omni-turbo-latest",
  "qwen-omni-turbo-2025-01-19",
  "qwen-omni-turbo-2025-03-26",
  "qwen3-omni-flash-2025-09-15",
  "qwen3-omni-flash-2025-12-01",
  "qwen3-vl-plus-2025-09-23",
  "qwen3-vl-plus-2025-12-19",
  "qwen3-vl-flash",
  "qwen3-vl-flash-2026-01-22",
  "qwen3-vl-flash-2025-10-15",
  "qwen3-vl-235b-a22b-instruct",
  "qwen3-vl-235b-a22b-thinking",
  "qwen3-vl-32b-instruct",
  "qwen3-vl-32b-thinking",
  "qwen3-vl-30b-a3b-instruct",
  "qwen3-vl-30b-a3b-thinking",
  "qwen3-vl-8b-instruct",
  "qwen3-vl-8b-thinking",
  "qwen-vl-max-latest",
  "qwen-vl-max-2025-08-13",
  "qwen-vl-max-2025-04-08",
  "qwen-vl-max-2025-01-25",
  "qwen-vl-plus-latest",
  "qwen-vl-plus-2025-08-15",
  "qwen-vl-plus-2025-07-10",
  "qwen-vl-plus-2025-05-07",
  "qwen-vl-plus-2025-01-25",
  "qvq-max-latest",
  "qvq-max-2025-05-15",
  "qvq-max-2025-03-25",
  "qvq-plus-latest",
  "qvq-plus-2025-05-15",
  "qwen2.5-vl-72b-instruct",
  "qwen2.5-vl-32b-instruct",
  "qwen2.5-vl-7b-instruct",
  "qwen2.5-vl-3b-instruct",
  "kimi/kimi-k2.5",
  "xiaomi/mimo-v2.5-pro"
]);
const unavailable = ["qwen-vl-max-2024-11-19","qwen3.8-2.4t-a95b","kimi-k3"];
const byId = new Map(VIDEO_MODELS.map(entry => [entry.id, entry]));
export function getModel(id, { allowCustom = false } = {}) {
  if (typeof id !== 'string' || TEXT_ONLY_MODELS.includes(id) || RETIRED_MODELS.includes(id) || unavailable.includes(id)) return null;
  if (byId.has(id)) return byId.get(id);
  // A custom ID cannot change the fixed official API endpoint.
  if (allowCustom && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(id) && !id.includes('..') && !/realtime|embedding|rerank/.test(id)) return { id, group: '自定义百炼模型', custom: true, stream: true };
  return null;
}
