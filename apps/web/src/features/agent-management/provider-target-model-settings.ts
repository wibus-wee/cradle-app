import { z } from 'zod'

import {
  getProviderTargetsByProviderTargetIdModelSettings,
  patchProviderTargetsByProviderTargetIdCustomModels,
  patchProviderTargetsByProviderTargetIdModelSettings,
  patchProviderTargetsByProviderTargetIdModelVisibility,
} from '~/api-gen/sdk.gen'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import {
  hasClaudeAgentModelAliases,
  readClaudeAgentModelAliases,
} from '~/features/agent-runtime/claude-agent-config'
import { ProfileConfigSchema } from '~/features/agent-runtime/profile-config-schema'
import type { ModelCapabilities, ProviderTarget } from '~/features/agent-runtime/types'

export interface EditableCustomModel {
  id: string
  label: string
  capabilities: ModelCapabilities
}

export interface ProviderTargetModelSettings {
  providerTargetKind?: ProviderTarget['kind']
  providerTargetId: string
  connectionConfigJson: string
  enabledModelsJson: string
  configJson: string
  customModelsJson: string
}

export const ModelCapabilitiesSchema = z
  .object({
    contextWindow: z.number().optional(),
  })
  .passthrough()

export const EditableCustomModelSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().optional(),
    capabilities: ModelCapabilitiesSchema.default({}),
    contextWindow: z.number().optional(),
  })
  .transform(item => ({
    id: item.id,
    label: item.label || item.id,
    capabilities:
      item.capabilities.contextWindow == null && item.contextWindow !== undefined
        ? { ...item.capabilities, contextWindow: item.contextWindow }
        : item.capabilities,
  }))

export const CustomModelsJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(EditableCustomModelSchema))

export const ProviderTargetModelSettingsSchema = z.object({
  providerTargetKind: z.enum(['manual', 'external']).optional(),
  providerTargetId: z.string(),
  connectionConfigJson: z.string(),
  enabledModelsJson: z.string(),
  configJson: z.string(),
  customModelsJson: z.string(),
})

export function providerTargetPath(target: ProviderTarget): string {
  return encodeURIComponent(target.id)
}

export function enabledModelsFromConfig(configJson: string): string[] {
  return ProfileConfigSchema.parse(JSON.parse(configJson)).enabledModels
}

export function claudeAgentAliasesFromConfig(configJson: string): ClaudeAgentModelAliases {
  return readClaudeAgentModelAliases(configJson)
}

export async function loadProviderTargetModelSettings(
  target: ProviderTarget,
): Promise<ProviderTargetModelSettings> {
  const { data } = await getProviderTargetsByProviderTargetIdModelSettings({
    path: { providerTargetId: target.id },
    throwOnError: true,
  })
  return ProviderTargetModelSettingsSchema.parse(data)
}

export async function updateProviderTargetModelVisibility(
  target: ProviderTarget,
  enabledModels: string[],
): Promise<ProviderTargetModelSettings> {
  const { data } = await patchProviderTargetsByProviderTargetIdModelVisibility({
    path: { providerTargetId: target.id },
    body: { enabledModels },
    throwOnError: true,
  })
  return ProviderTargetModelSettingsSchema.parse(data)
}

export async function updateProviderTargetClaudeAgentAliases(
  target: ProviderTarget,
  aliases: ClaudeAgentModelAliases,
): Promise<ProviderTargetModelSettings> {
  const { data } = await patchProviderTargetsByProviderTargetIdModelSettings({
    path: { providerTargetId: target.id },
    body: {
      claudeAgent: hasClaudeAgentModelAliases(aliases)
        ? { modelAliases: aliases }
        : null,
    },
    throwOnError: true,
  })
  return ProviderTargetModelSettingsSchema.parse(data)
}

export async function updateProviderTargetCustomModels(
  target: ProviderTarget,
  models: EditableCustomModel[],
): Promise<EditableCustomModel[]> {
  const sanitized = z.array(EditableCustomModelSchema).parse(models)
  const { data } = await patchProviderTargetsByProviderTargetIdCustomModels({
    path: { providerTargetId: target.id },
    body: {
      models: sanitized.map(model => ({
        id: model.id,
        label: model.label !== model.id ? model.label : undefined,
      })),
    },
    throwOnError: true,
  })
  return z.array(EditableCustomModelSchema).parse(data)
}
