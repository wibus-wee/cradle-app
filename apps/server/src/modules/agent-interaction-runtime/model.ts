import { t } from 'elysia'

const agentSessionStatus = t.Union([
  t.Literal('created'),
  t.Literal('active'),
  t.Literal('completed'),
  t.Literal('stopped'),
  t.Literal('failed'),
])

export const AgentInteractionRuntimeModel = {
  agentSessionStatus,

  agentActivity: t.Object({
    id: t.String(),
    agentSessionId: t.String(),
    type: t.Union([
      t.Literal('thought'),
      t.Literal('action'),
      t.Literal('response'),
      t.Literal('elicitation'),
      t.Literal('error'),
      t.Literal('prompt'),
    ]),
    content: t.String(),
    signal: t.Nullable(t.String()),
    signalMetadata: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  session: t.Object({
    id: t.String(),
    issueId: t.String(),
    providerTargetId: t.String(),
    agentId: t.Nullable(t.String()),
    chatSessionId: t.Nullable(t.String()),
    status: agentSessionStatus,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  agentSessionIdParams: t.Object({ agentSessionId: t.String() }),
}
