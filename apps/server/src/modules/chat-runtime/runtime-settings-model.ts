import { t } from 'elysia'

export const runtimeSettingsValueSchema = t.Union([
  t.String(),
  t.Number(),
  t.Boolean(),
])

export const runtimeSettingsSchema = t.Object({}, {
  additionalProperties: runtimeSettingsValueSchema,
})

export const runtimeSettingsPatchSchema = t.Object({}, {
  additionalProperties: t.Union([
    runtimeSettingsValueSchema,
    t.Null(),
  ]),
})

export const claudeAgentConfigPatchSchema = t.Object({
  modelAliases: t.Optional(t.Object({
    haiku: t.Optional(t.String()),
    sonnet: t.Optional(t.String()),
    opus: t.Optional(t.String()),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const claudeAgentPermissionModePatchSchema = t.Union([
  t.Literal('default'),
  t.Literal('acceptEdits'),
  t.Literal('bypassPermissions'),
  t.Literal('plan'),
  t.Null(),
])

const accessModePatchSchema = t.Union([
  t.Literal('approval-required'),
  t.Literal('full-access'),
  t.Null(),
])

const interactionModePatchSchema = t.Union([
  t.Literal('default'),
  t.Literal('plan'),
  t.Null(),
])

/** Session/runtime patch that may include provider-native settings plus Claude alias config. */
export const sessionRuntimeSettingsPatchSchema = t.Object({
  permissionMode: t.Optional(claudeAgentPermissionModePatchSchema),
  accessMode: t.Optional(accessModePatchSchema),
  interactionMode: t.Optional(interactionModePatchSchema),
  claudeAgent: t.Optional(t.Union([
    claudeAgentConfigPatchSchema,
    t.Null(),
  ])),
}, {
  additionalProperties: t.Union([
    runtimeSettingsValueSchema,
    t.Null(),
  ]),
})

export const claudeAgentModelAliasesSchema = t.Object({
  haiku: t.String(),
  sonnet: t.String(),
  opus: t.String(),
}, { additionalProperties: false })

export const sessionClaudeAgentConfigSchema = t.Object({
  modelAliases: claudeAgentModelAliasesSchema,
}, { additionalProperties: false })
