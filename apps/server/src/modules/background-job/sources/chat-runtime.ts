import { backendRuns } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../../infra'
import * as ChatRuntime from '../../chat-runtime/runtime'
import type { BackgroundJobSourceAdapter } from '../types'

export const chatRuntimeSourceAdapter: BackgroundJobSourceAdapter = {
  sourceKind: 'chat-runtime-run',

  async read(job) {
    if (!job.sourceRunId) {
      return {
        status: 'failed',
        errorCode: 'background_job_chat_run_missing',
        errorMessage: 'Chat Runtime Background Job does not have a source run id',
      }
    }
    const run = db().select().from(backendRuns).where(eq(backendRuns.id, job.sourceRunId)).get()
    if (!run) {
      return {
        status: 'failed',
        errorCode: 'background_job_chat_run_not_found',
        errorMessage: `Chat run ${job.sourceRunId} was not found`,
      }
    }
    if (run.status === 'streaming') {
      return {
        status: 'running',
        startedAt: run.startedAt,
      }
    }
    if (run.status === 'complete') {
      return {
        status: 'succeeded',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        result: {
          stopReason: run.stopReason,
          runId: run.id,
          sessionId: run.chatSessionId,
        },
      }
    }
    if (run.status === 'aborted') {
      return {
        status: 'cancelled',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        errorCode: 'chat_run_aborted',
        errorMessage: run.errorText ?? 'Chat Runtime work was aborted',
        errorDetails: { stopReason: run.stopReason },
      }
    }
    return {
      status: 'failed',
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorCode: 'chat_run_failed',
      errorMessage: run.errorText ?? 'Chat Runtime work failed',
      errorDetails: { stopReason: run.stopReason },
    }
  },

  async cancel(job) {
    if (job.sourceSessionId) {
      await ChatRuntime.cancelSession(job.sourceSessionId)
    }
  },
}
