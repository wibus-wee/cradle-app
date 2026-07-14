import { Elysia, t } from 'elysia'

import * as ChatRuntime from '../chat-runtime/runtime'
import { TurnCheckpointModel } from './model'
import * as TurnCheckpoint from './service'

export const turnCheckpoint = new Elysia({
  prefix: '/sessions',
  detail: { tags: ['turn-checkpoint'] },
})
  .get('/:id/turn-checkpoints', ({ params }) => TurnCheckpoint.listForSession(params.id), {
    detail: {
      'summary': 'List turn checkpoints for a chat session',
      'x-cradle-cli': { command: ['chat', 'session', 'checkpoint', 'list'], defaultChatSessionId: true },
    },
    params: TurnCheckpointModel.sessionParams,
    response: { 200: t.Array(TurnCheckpointModel.checkpoint) },
  })
  .post('/:id/turn-checkpoints/:checkpointId/restore', async ({ params }) => {
    let checkpoint: TurnCheckpoint.TurnCheckpointView | undefined
    try {
      const rollback = await ChatRuntime.rollbackLastTurn(params.id, {
        beforeProviderRollback: async () => {
          checkpoint = await TurnCheckpoint.restoreWorkspaceStart({
            sessionId: params.id,
            checkpointId: params.checkpointId,
          })
        },
      })
      if (!checkpoint) {
        throw new Error('Checkpoint restore callback completed without a checkpoint result')
      }
      return {
        checkpoint,
        transcriptReverted: true,
        providerRolledBackTurns: rollback.providerRolledBackTurns,
      }
    }
    catch (error) {
      if (!checkpoint) {
        throw error
      }
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        workspaceRestored: true,
        checkpointId: checkpoint.id,
      })
    }
  }, {
    detail: {
      'summary': 'Restore the latest turn checkpoint and roll back its chat turn',
      'x-cradle-cli': { command: ['chat', 'session', 'checkpoint', 'restore'], defaultChatSessionId: true },
    },
    params: TurnCheckpointModel.checkpointParams,
    response: { 200: TurnCheckpointModel.restoreResponse },
  })
  .post('/:id/turn-checkpoints/:checkpointId/rewind', async ({ params }) => {
    const plan = TurnCheckpoint.planHistoricalRewind({
      sessionId: params.id,
      checkpointId: params.checkpointId,
    })
    const subsequentCheckpointIds = plan.subsequentCheckpoints.map(checkpoint => checkpoint.id)
    let checkpoint: TurnCheckpoint.TurnCheckpointView | undefined
    let transcriptReverted = false
    try {
      const rollback = await ChatRuntime.rollbackTurns(params.id, plan.rollbackTurns, {
        beforeProviderRollback: async () => {
          checkpoint = await TurnCheckpoint.restoreHistoricalCheckpoint({
            sessionId: params.id,
            checkpointId: params.checkpointId,
            expectedSubsequentCheckpointIds: subsequentCheckpointIds,
          })
        },
        afterRollback: async () => {
          transcriptReverted = true
          await TurnCheckpoint.cleanupHistoricalRewind({
            sessionId: params.id,
            checkpointId: params.checkpointId,
            subsequentCheckpointIds,
          })
        },
      })
      if (!checkpoint) {
        throw new Error('Checkpoint rewind callback completed without a checkpoint result')
      }
      return {
        checkpoint,
        transcriptReverted,
        rewoundTurns: plan.rollbackTurns,
        providerRolledBackTurns: rollback.providerRolledBackTurns,
        removedCheckpointIds: subsequentCheckpointIds,
      }
    }
    catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        workspaceRestored: Boolean(checkpoint),
        transcriptReverted,
        checkpointId: params.checkpointId,
      })
    }
  }, {
    detail: {
      'summary': 'Rewind a chat session to a completed turn checkpoint',
      'x-cradle-cli': { command: ['chat', 'session', 'checkpoint', 'rewind'], defaultChatSessionId: true },
    },
    params: TurnCheckpointModel.checkpointParams,
    response: { 200: TurnCheckpointModel.rewindResponse },
  })
