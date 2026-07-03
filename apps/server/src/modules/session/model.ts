import { t } from 'elysia'

import { sessionRuntimeSettingsPatchSchema } from '../chat-runtime/runtime-settings-model'

const runtimeKindSchema = t.String({ minLength: 1 })

const nullableString = t.Nullable(t.String())
const nullableRequiredString = t.Nullable(t.String({ minLength: 1 }))
const thinkingEffortSchema = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh')
])
const sessionStatusSchema = t.Union([t.Literal('idle'), t.Literal('streaming'), t.Literal('error')])
const sideContextSourceSchema = t.Union([t.Literal('provider-native'), t.Literal('cradle-context')])

export const SessionModel = {
  session: t.Object({
    id: t.String(),
    parentSessionId: nullableString,
    sideContextSource: t.Nullable(sideContextSourceSchema),
    workspaceId: nullableString,
    title: nullableString,
    origin: t.String(),
    providerTargetId: nullableString,
    agentId: nullableString,
    modelId: nullableString,
    thinkingEffort: t.Nullable(thinkingEffortSchema),
    linkedIssueId: nullableString,
    runtimeKind: runtimeKindSchema,
    status: sessionStatusSchema,
    pinned: t.Number(),
    archivedAt: t.Nullable(t.Number()),
    lastReadAt: t.Nullable(t.Number()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    latestUserMessageAt: t.Nullable(t.Number()),
    latestAssistantMessageAt: t.Nullable(t.Number()),
    unread: t.Boolean()
  }),

  exportMarkdownResponse: t.Object({
    markdown: t.String()
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 })
  }),

  listQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    origin: t.Optional(t.String({ minLength: 1 })),
    archived: t.Optional(t.Boolean())
  }),

  createBody: t.Object({
    workspaceId: t.Optional(nullableRequiredString),
    title: t.String({ minLength: 1 }),
    origin: t.Optional(t.String({ minLength: 1 })),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(nullableRequiredString),
    agentId: t.Optional(t.String({ minLength: 1 })),
    runtimeKind: t.Optional(runtimeKindSchema),
    runtimeSettings: t.Optional(sessionRuntimeSettingsPatchSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    id: t.Optional(t.String())
  }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    pinned: t.Optional(t.Boolean()),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(nullableRequiredString),
    thinkingEffort: t.Optional(t.Nullable(thinkingEffortSchema))
  }),

  archiveBody: t.Object({
    archived: t.Boolean()
  })
}
