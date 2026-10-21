// Video-analysis choices selected from the supplied free-quota model IDs.
// No account balance, usage or expiry information is stored here.
export const CATALOG_DATE = '2026-10-21';
export const DEFAULT_MODEL = 'qwen3.7-plus';
export const VIDEO_MODELS = Object.freeze([
  {
    "id": "qwen3.7-plus",
    "group": "优先试用",
    "thinking": false,
    "recommended": true
  },
  {
    "id": "qwen3.8-max",
    "group": "优先试用",
    "thinking": false,
    "recommended": true
  },
  {
    "id": "qwen3.8-flash",
    "group": "优先试用",
    "thinking": false,
    "recommended": true
  },
  {
    "id": "qwen3-vl-plus",
    "group": "优先试用",
    "thinking": false,
    "recommended": true
  },
  {
    "id": "qwen3.8-max-0902",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.7-plus-2026-05-26",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.7-flash",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.7-flash-2026-07-15",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.7-max-2026-06-08",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.6-plus",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.6-plus-2026-04-02",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.6-flash",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.6-flash-2026-04-16",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-plus",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-plus-2026-02-15",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-plus-2026-04-20",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-flash",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-flash-2026-02-23",
    "group": "其他千问视频模型",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.8-27b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.6-35b-a3b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.6-27b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-397b-a17b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-122b-a10b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-27b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.5-35b-a3b",
    "group": "千问 · 开源视觉",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "qwen3.8-omni-flash",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true,
    "recommended": false
  },
  {
    "id": "qwen3.5-omni-plus",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true,
    "recommended": false
  },
  {
    "id": "qwen3-omni-flash",
    "group": "千问 · Omni",
    "omni": true,
    "stream": true,
    "recommended": false
  },
  {
    "id": "kimi-k2.6",
    "group": "Kimi",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "kimi-k2.5",
    "group": "Kimi",
    "thinking": false,
    "recommended": false
  },
  {
    "id": "kimi-k2.7-code",
    "group": "Kimi · 思考",
    "thinking": true,
    "stream": true,
    "recommended": false
  }
].map(Object.freeze));
export const TEXT_ONLY_MODELS = Object.freeze(['glm-5.3', 'deepseek-v4-pro-0813']);
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
const byId = new Map(VIDEO_MODELS.map(entry => [entry.id, entry]));
// Deliberately allow only the selected models, including for direct client calls.
export function getModel(id) { return typeof id === 'string' ? byId.get(id) ?? null : null; }
