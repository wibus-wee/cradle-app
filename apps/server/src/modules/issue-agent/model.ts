import { t } from 'elysia'

import { AgentInteractionRuntimeModel } from '../agent-interaction-runtime/model'

export const IssueAgentModel = {
  agentActivity: AgentInteractionRuntimeModel.agentActivity,

  delegationState: t.Object({
    issueId: t.String(),
    delegated: t.Boolean(),
    providerTargetId: t.Nullable(t.String()),
    agentId: t.Nullable(t.String()),
    agentSessionId: t.Nullable(t.String()),
    chatSessionId: t.Nullable(t.String()),
  }),

  sessionView: t.Object({
    id: t.String(),
    issueId: t.String(),
    providerTargetId: t.String(),
    agentId: t.Nullable(t.String()),
    chatSessionId: t.Nullable(t.String()),
    status: AgentInteractionRuntimeModel.agentSessionStatus,
    isCurrentDelegation: t.Boolean(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  // ── params / body ──

  issueIdParams: t.Object({ id: t.String() }),
  agentSessionIdParams: t.Object({ agentSessionId: t.String() }),

  delegateBody: t.Object({
    agentId: t.String({ minLength: 1 }),
    providerTargetId: t.Optional(t.Nullable(t.String())),
  }),

  continuationBody: t.Object({
    mode: t.Union([t.Literal('queue'), t.Literal('steer')]),
    text: t.String({ minLength: 1 }),
  }),

  continuationResponse: t.Object({
    ok: t.Literal(true),
    chatSessionId: t.String(),
    continuationId: t.String(),
    mode: t.Union([t.Literal('queue'), t.Literal('steer')]),
  }),

  rerunBody: t.Object({}),
}
