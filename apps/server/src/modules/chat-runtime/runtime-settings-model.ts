import { t } from 'elysia'

export const runtimeAccessModeSchema = t.Union([
  t.Literal('approval-required'),
  t.Literal('full-access'),
])

export const runtimeInteractionModeSchema = t.Union([
  t.Literal('default'),
  t.Literal('plan'),
])

export const runtimeSettingsSchema = t.Object({
  accessMode: runtimeAccessModeSchema,
  interactionMode: runtimeInteractionModeSchema,
})

export const runtimeSettingsPatchSchema = t.Object({
  accessMode: t.Optional(runtimeAccessModeSchema),
  interactionMode: t.Optional(runtimeInteractionModeSchema),
})

export const sessionRuntimeSettingsPatchSchema = t.Object({
  accessMode: t.Optional(runtimeAccessModeSchema),
  interactionMode: t.Optional(runtimeInteractionModeSchema),
  claudeAgent: t.Optional(t.Union([
    t.Object({
      modelAliases: t.Optional(t.Object({
        haiku: t.Optional(t.String()),
        sonnet: t.Optional(t.String()),
        opus: t.Optional(t.String()),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    t.Null(),
  ])),
})

export const claudeAgentModelAliasesSchema = t.Object({
  haiku: t.String(),
  sonnet: t.String(),
  opus: t.String(),
}, { additionalProperties: false })

export const sessionClaudeAgentConfigSchema = t.Object({
  modelAliases: claudeAgentModelAliasesSchema,
}, { additionalProperties: false })
