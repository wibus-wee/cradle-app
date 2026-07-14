import { t } from 'elysia'

import { AutomationModel } from '../automation/model'
import { pullRequestViewSchema } from '../pull-request/model'
import { ThreadHandoffModel } from '../thread-handoff/model'
import { TurnCheckpointModel } from '../turn-checkpoint/model'
import { UsageModel } from '../usage/model'

const pin = t.Object({
  sessionId: t.String(),
  messageId: t.String(),
  label: t.Nullable(t.String()),
  done: t.Boolean(),
  pinnedAt: t.Number(),
  updatedAt: t.Number(),
})

const marker = t.Object({
  id: t.String(),
  sessionId: t.String(),
  messageId: t.String(),
  startOffset: t.Number(),
  endOffset: t.Number(),
  selectedText: t.String(),
  style: t.Union([t.Literal('highlight'), t.Literal('underline')]),
  color: t.Union([t.Literal('yellow'), t.Literal('blue'), t.Literal('green'), t.Literal('pink')]),
  label: t.Nullable(t.String()),
  done: t.Boolean(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

export const SessionEnvironmentModel = {
  pin,
  marker,
  sessionParams: t.Object({ id: t.String({ minLength: 1 }) }),
  messageParams: t.Object({
    id: t.String({ minLength: 1 }),
    messageId: t.String({ minLength: 1 }),
  }),
  markerParams: t.Object({
    id: t.String({ minLength: 1 }),
    markerId: t.String({ minLength: 1 }),
  }),
  environment: t.Object({
    sessionId: t.String(),
    notes: t.String(),
    pins: t.Array(pin),
    markers: t.Array(marker),
    usage: UsageModel.sessionUsage,
    pullRequest: t.Nullable(pullRequestViewSchema),
    automationRuns: t.Array(AutomationModel.run),
    checkpoints: t.Array(TurnCheckpointModel.checkpoint),
    handoff: t.Nullable(ThreadHandoffModel.handoff),
  }),
  notesBody: t.Object({ notes: t.String({ maxLength: 16_000 }) }, { additionalProperties: false }),
  notesResponse: t.Object({ sessionId: t.String(), notes: t.String(), updatedAt: t.Number() }),
  pinPatchBody: t.Object({
    label: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
    done: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),
  markerCreateBody: t.Object({
    messageId: t.String({ minLength: 1 }),
    startOffset: t.Number({ minimum: 0 }),
    endOffset: t.Number({ minimum: 1 }),
    selectedText: t.String({ minLength: 1, maxLength: 2_000 }),
    style: t.Union([t.Literal('highlight'), t.Literal('underline')]),
    color: t.Union([t.Literal('yellow'), t.Literal('blue'), t.Literal('green'), t.Literal('pink')]),
  }, { additionalProperties: false }),
  markerPatchBody: t.Object({
    label: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
    done: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),
  ok: t.Object({ ok: t.Literal(true) }),
}
