import { t } from 'elysia'

const nullableString = t.Nullable(t.String())

export const WorkflowRulesModel = {
  workflowRuleEntry: t.Object({
    type: t.Union([t.Literal('global'), t.Literal('agent')]),
    agentId: nullableString,
    content: t.String(),
  }),

  workflowRules: t.Object({
    global: nullableString,
    agentSpecific: nullableString,
  }),

  workspaceIdParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  getQuery: t.Object({
    agentId: t.Optional(t.String()),
  }),

  saveBody: t.Object({
    agentId: t.Optional(nullableString),
    content: t.String(),
  }),

  deleteQuery: t.Object({
    agentId: t.Optional(t.String()),
  }),
}
