/**
 * Provider Preset Overlay
 *
 * Curated layer on top of the public models.dev registry. Entries here win on
 * conflicts (base URL, display name, wire-protocol quirks) and supply vendors
 * that models.dev does not cover at all (Volcengine Ark coding endpoint,
 * local servers such as Ollama). Icon slugs reference @lobehub/icons-static-png.
 */

export interface ProviderPresetOverlayEntry {
  /** Stable slug, e.g. 'deepseek', 'ollama' */
  id: string
  /** Display name */
  name: string
  providerKind: 'openai-compatible' | 'anthropic' | 'universal'
  baseUrl: string
  /** Hostnames used to match user endpoints back to this preset */
  hostnames: string[]
  iconSlug?: string
  docsUrl?: string
  /** true for localhost servers (Ollama, LM Studio) */
  local?: boolean
  /** default true; false for local entries */
  requiresApiKey?: boolean
  anthropicWireAuth?: 'x-api-key' | 'bearer-token'
  defaultModels?: string[]
}

export const PROVIDER_PRESET_OVERLAY: ProviderPresetOverlayEntry[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    // Dual OpenAI + Anthropic URLs; WireShape is universal via contribution.
    providerKind: 'universal',
    baseUrl: 'https://api.deepseek.com/v1',
    hostnames: ['api.deepseek.com'],
    iconSlug: 'deepseek',
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    defaultModels: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
  },
  {
    id: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    providerKind: 'openai-compatible',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    hostnames: ['xiaomimimo.com'],
    iconSlug: 'xiaomimimo',
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
    defaultModels: [
      'mimo-v2.5-pro',
      'mimo-v2.5',
    ],
  },
  {
    id: 'volcengine-ark-coding',
    name: 'Volcengine Ark Coding',
    providerKind: 'anthropic',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    hostnames: ['ark.cn-beijing.volces.com'],
    iconSlug: 'volcengine',
    anthropicWireAuth: 'bearer-token',
    defaultModels: [
      'glm-5.2',
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    // Dual OpenAI + Anthropic URLs; WireShape is universal via contribution.
    providerKind: 'universal',
    baseUrl: 'https://api.moonshot.cn/v1',
    hostnames: ['api.moonshot.cn'],
    iconSlug: 'moonshot',
    docsUrl: 'https://platform.moonshot.cn/docs/api/chat',
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    providerKind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hostnames: ['open.bigmodel.cn'],
    iconSlug: 'zhipu',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/introduction',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    providerKind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    hostnames: ['openrouter.ai'],
    iconSlug: 'openrouter',
    docsUrl: 'https://openrouter.ai/models',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    providerKind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hostnames: ['api.siliconflow.cn'],
    iconSlug: 'siliconcloud',
    docsUrl: 'https://cloud.siliconflow.com/models',
  },
  {
    id: 'groq',
    name: 'Groq',
    providerKind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    hostnames: ['api.groq.com'],
    iconSlug: 'groq',
    docsUrl: 'https://console.groq.com/docs/models',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    providerKind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    hostnames: ['localhost'],
    iconSlug: 'ollama',
    docsUrl: 'https://ollama.com',
    local: true,
    requiresApiKey: false,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    providerKind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    hostnames: ['localhost', '127.0.0.1'],
    iconSlug: 'lmstudio',
    docsUrl: 'https://lmstudio.ai/models',
    local: true,
    requiresApiKey: false,
  },
]
