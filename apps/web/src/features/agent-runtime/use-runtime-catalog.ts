// Runtime catalog query boundary for Chat, Jarvis, and runtime-aware settings.

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { client } from '~/lib/client.config'
import type { ProviderKind, RuntimeKind } from '~/features/agent-runtime/types'

export type RuntimeCatalogSurface = 'chat' | 'jarvis'

export interface RuntimeCatalogItem {
  runtimeKind: RuntimeKind
  label: string
  description?: string
  providerKinds: ProviderKind[]
  providerBinding?: 'required' | 'runtime-owned'
  iconKey?: string
  surfaces: RuntimeCatalogSurface[]
  sortOrder?: number
  source: 'builtin' | 'plugin'
  pluginOwner: string | null
}

const RuntimeCatalogSchema = z.object({
  items: z.array(z.object({
    runtimeKind: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    providerKinds: z.array(z.string().min(1)),
    providerBinding: z.enum(['required', 'runtime-owned']).optional(),
    iconKey: z.string().optional(),
    surfaces: z.array(z.enum(['chat', 'jarvis'])).optional(),
    sortOrder: z.number().optional(),
    source: z.enum(['builtin', 'plugin']),
    pluginOwner: z.string().nullable(),
  })),
})

export const RUNTIME_CATALOG_QUERY_KEY = ['chat', 'runtimes'] as const

export const FALLBACK_RUNTIME_CATALOG: RuntimeCatalogItem[] = [
  {
    runtimeKind: 'jar-core',
    label: 'HiJarvis',
    description: 'Multi-surface AI agent with local memory',
    providerKinds: ['openai-compatible', 'anthropic'],
    iconKey: 'hijarvis',
    surfaces: ['jarvis'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 10,
  },
  {
    runtimeKind: 'codex',
    label: 'Codex',
    description: 'Codex app-server runtime',
    providerKinds: ['openai-compatible'],
    iconKey: 'codex',
    surfaces: ['chat', 'jarvis'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 20,
  },
  {
    runtimeKind: 'opencode',
    label: 'Opencode',
    description: 'Opencode server runtime',
    providerKinds: ['openai-compatible', 'anthropic'],
    providerBinding: 'runtime-owned',
    iconKey: 'opencode',
    surfaces: ['chat', 'jarvis'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 25,
  },
  {
    runtimeKind: 'claude-agent',
    label: 'Claude Agent',
    description: 'Claude Agent SDK runtime',
    providerKinds: ['anthropic'],
    iconKey: 'claude-agent',
    surfaces: ['chat', 'jarvis'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 30,
  },
  {
    runtimeKind: 'acp-chat',
    label: 'ACP Chat',
    description: 'Cloud Agent SDK runtime',
    providerKinds: ['openai-compatible', 'anthropic'],
    iconKey: 'custom',
    surfaces: ['chat', 'jarvis'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 40,
  },
  {
    runtimeKind: 'standard',
    label: 'Standard',
    description: 'Direct OpenAI-compatible chat runtime',
    providerKinds: ['openai-compatible'],
    iconKey: 'custom',
    surfaces: ['chat', 'jarvis'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 50,
  },
  {
    runtimeKind: 'cli-tui',
    label: 'CLI TUI',
    description: 'Launch a configured terminal agent',
    providerKinds: [],
    iconKey: 'claude-cli',
    surfaces: ['chat'],
    source: 'builtin',
    pluginOwner: null,
    sortOrder: 60,
  },
]

const HIDDEN_RUNTIME_KINDS = new Set<RuntimeKind>([
  ...(import.meta.env.CRADLE_E2E === '1' ? ['acp-chat'] : ['acp-chat', 'standard']),
  // opencode runtime is in private preview — only surface in dev builds.
  ...(import.meta.env.DEV ? [] : ['opencode']),
])

function normalizeCatalogItem(item: z.infer<typeof RuntimeCatalogSchema>['items'][number]): RuntimeCatalogItem {
  return {
    ...item,
    providerKinds: item.providerKinds as ProviderKind[],
    surfaces: item.surfaces ?? ['chat'],
  }
}

export async function fetchRuntimeCatalog(): Promise<RuntimeCatalogItem[]> {
  const response = await client.get<unknown>({ url: '/chat/runtimes' })
  return RuntimeCatalogSchema.parse(response.data).items.map(normalizeCatalogItem)
}

export function useRuntimeCatalog() {
  const query = useQuery({
    queryKey: RUNTIME_CATALOG_QUERY_KEY,
    queryFn: fetchRuntimeCatalog,
    staleTime: 30_000,
  })

  return {
    ...query,
    runtimes: query.data ?? FALLBACK_RUNTIME_CATALOG,
  }
}

export function listRuntimeCatalogForSurface(
  runtimes: RuntimeCatalogItem[],
  surface: RuntimeCatalogSurface,
): RuntimeCatalogItem[] {
  return runtimes.filter(runtime =>
    runtime.surfaces.includes(surface) && !HIDDEN_RUNTIME_KINDS.has(runtime.runtimeKind))
}
