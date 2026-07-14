import { t } from 'elysia'

const nullableString = t.Nullable(t.String())
const nullableNumber = t.Nullable(t.Number())

const checkpoint = t.Object({
  id: t.String(),
  sessionId: t.String(),
  runId: t.String(),
  assistantMessageId: nullableString,
  workspaceId: nullableString,
  workspacePath: t.String(),
  startRef: t.String(),
  endRef: nullableString,
  status: t.Union([t.Literal('capturing'), t.Literal('completed'), t.Literal('failed')]),
  changedFiles: t.Number(),
  additions: t.Number(),
  deletions: t.Number(),
  errorText: nullableString,
  completedAt: nullableNumber,
  restoredAt: nullableNumber,
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

export const TurnCheckpointModel = {
  checkpoint,
  sessionParams: t.Object({ id: t.String({ minLength: 1 }) }),
  checkpointParams: t.Object({
    id: t.String({ minLength: 1 }),
    checkpointId: t.String({ minLength: 1 }),
  }),
  restoreResponse: t.Object({
    checkpoint,
    transcriptReverted: t.Boolean(),
    providerRolledBackTurns: t.Number(),
  }),
  rewindResponse: t.Object({
    checkpoint,
    transcriptReverted: t.Boolean(),
    rewoundTurns: t.Number(),
    providerRolledBackTurns: t.Number(),
    removedCheckpointIds: t.Array(t.String()),
  }),
}
