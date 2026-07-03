// Runtime catalog query boundary for Chat, Jarvis, and runtime-aware settings.

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import type { ProviderKind } from '~/features/agent-runtime/types'
import { client } from '~/lib/client.config'

import type { RuntimeCatalogItem } from './runtime-catalog'

export type {
  RuntimeCatalogComposer,
  RuntimeCatalogItem,
  RuntimeCatalogSlot,
  RuntimeCatalogSlotSurface,
  RuntimeCatalogSurface,
} from './runtime-catalog'
export {
  DEFAULT_RUNTIME_CATALOG_COMPOSER,
  listRuntimeCatalogForSurface,
  runtimeCatalogItemHasSlotId,
  runtimeCatalogItemHasSlotName,
  runtimeCatalogItemRequiresProviderTarget,
  runtimeCatalogItemUsesAliasMatrixModelSelection,
  runtimeCatalogItemUsesCliLaunchConfig,
  runtimeCatalogItemUsesModelSelection,
  runtimeComposerAllowsEmptySubmit,
  runtimeComposerSupportsSlashCommands,
  runtimeComposerSupportsThinking,
  runtimeComposerUsesAliasMatrixModelSelection,
  runtimeComposerUsesCollapsedInput,
  runtimeComposerUsesModelSelection,
} from './runtime-catalog'

const RuntimeCatalogCapabilitiesSchema = z.object({
  supportsSteerTurn: z.boolean(),
  supportsShellExecution: z.boolean(),
  supportsLastTurnRollback: z.boolean(),
  supportsRuntimeSettings: z.boolean(),
  supportsUiSlotStates: z.boolean(),
  supportsDynamicCapabilities: z.boolean(),
  supportsTitleGeneration: z.boolean(),
  sessionModelSwitch: z.enum(['in-session', 'restart-session', 'unsupported']),
})

const RuntimeCatalogDegradationSchema = z.object({
  capability: z.string().min(1),
  status: z.enum(['unsupported', 'partial', 'experimental']),
  reason: z.string().min(1),
})

const RuntimeCatalogIconSchema = z.union([
  z.object({ key: z.string().min(1) }),
  z.object({ svg: z.string().min(1) }),
  z.object({ url: z.string().min(1) }),
])

const RuntimeCatalogComposerSchema = z.object({
  inputMode: z.enum(['rich', 'collapsed', 'none']),
  allowEmptySubmit: z.boolean().optional(),
  modelSelection: z.enum(['provider-model', 'runtime-owned', 'alias-matrix', 'none']),
  thinking: z.union([
    z.object({
      efforts: z.array(z.string().min(1)),
    }),
    z.enum(['per-model', 'unsupported']),
  ]),
})

const RuntimeCatalogSlotCommandActionSchema = z.union([
  z.object({
    kind: z.literal('insertText'),
  }),
  z.object({
    kind: z.literal('submitText'),
    requiresEmptyComposer: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('uiAction'),
    actionId: z.string().min(1),
  }),
])

const RuntimeCatalogSlotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  label: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  aliases: z.array(z.string()).optional(),
  iconKey: z.enum([
    'alert',
    'approvals',
    'code-review',
    'compact',
    'config',
    'diff',
    'feedback',
    'filesystem',
    'goal',
    'crew',
    'ide-context',
    'mcp',
    'model',
    'personality',
    'plugin',
    'plan',
    'progress',
    'quick-question',
    'user-input',
    'reasoning',
    'search',
    'side-chat',
    'skills',
    'status',
    'terminal',
    'tool-activity',
    'usage',
  ]).optional(),
  commandText: z.string().optional(),
  commandAction: RuntimeCatalogSlotCommandActionSchema.optional(),
  requiresSession: z.boolean().optional(),
  surfaces: z.array(z.enum([
    'slashCommand',
    'toolbarPicker',
    'composerState',
    'messageInline',
    'runtimePanel',
    'streamEvidence',
    'recordOnly',
  ])),
})

const RuntimeCatalogSchema = z.object({
  items: z.array(z.object({
    runtimeKind: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    providerKinds: z.array(z.string().min(1)),
    providerBinding: z.enum(['required', 'runtime-owned']).optional(),
    sessionLaunchMode: z.enum(['runtime-provider', 'agent-terminal']),
    iconKey: z.string().optional(),
    surfaces: z.array(z.enum(['chat', 'jarvis'])).optional(),
    sortOrder: z.number().optional(),
    stability: z.enum(['stable', 'experimental']).optional(),
    availability: z.enum(['stable', 'preview', 'dev-only', 'hidden']),
    degradations: z.array(RuntimeCatalogDegradationSchema).optional(),
    icon: RuntimeCatalogIconSchema,
    composer: RuntimeCatalogComposerSchema,
    slots: z.array(RuntimeCatalogSlotSchema),
    settingsSchema: z.record(z.string(), z.unknown()).optional(),
    source: z.enum(['builtin', 'plugin']),
    pluginOwner: z.string().nullable(),
    capabilities: RuntimeCatalogCapabilitiesSchema.nullable(),
  })),
})

export const RUNTIME_CATALOG_QUERY_KEY = ['chat', 'runtimes'] as const

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
    runtimes: query.data ?? [],
  }
}
