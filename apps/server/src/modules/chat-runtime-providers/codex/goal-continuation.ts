import type { UIMessage } from 'ai'

import { readObjectRecord } from '../../../helpers/json-record'
import type { RuntimeGoalContinuation } from '../../chat-runtime/runtime-provider-types'
import { readProviderStateSnapshot } from '../provider-state-snapshot'
import {
  isCodexCompactCommand,
  readCodexGoalCommandObjective,
} from './turn/input-projector'

export const CODEX_GOAL_CONTINUATION_PROMPT = '[internal] Continue the active Codex goal.'

export function createCodexGoalContinuation(): RuntimeGoalContinuation {
  return {
    continuationPrompt: CODEX_GOAL_CONTINUATION_PROMPT,
    readContinuableGoal: ({ providerStateSnapshot, options }) => {
      try {
        const snapshot = readProviderStateSnapshot(providerStateSnapshot)
        const codex = readObjectRecord(snapshot.codex)
        const goal = readObjectRecord(codex.goal)
        if (!isContinuableCodexGoalStatus(goal.status, {
          includeBlockedGoals: options?.includeBlockedGoals,
        })) {
          return null
        }
        if (typeof goal.objective !== 'string' || goal.objective.trim().length === 0) {
          return null
        }
        return {
          objective: goal.objective.trim(),
          status: String(goal.status),
        }
      }
      catch {
        return null
      }
    },
    readGoalCommandObjective: ({ text }) => readCodexGoalCommandObjective(text),
    annotateContinuationMessage: ({ message }) => annotateCodexGoalContinuationMessage(message),
    isContinuationMessage: ({ message }) => isCodexGoalContinuationMessage(message),
    allowsEmptyResponse: ({ message }) =>
      isCodexGoalContinuationMessage(message)
      || readCodexGoalCommandObjective(message) !== null
      || isCodexCompactCommand(message),
  }
}

function isContinuableCodexGoalStatus(
  status: unknown,
  options: { includeBlockedGoals?: boolean } = {},
): boolean {
  return status === 'active' || (options.includeBlockedGoals === true && status === 'blocked')
}

export function annotateCodexGoalContinuationMessage(message: UIMessage): UIMessage {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  const codexMetadata = readObjectRecord(cradleMetadata.codex)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        codex: {
          ...codexMetadata,
          goalContinuation: true,
        },
      },
    },
  } as UIMessage
}

export function isCodexGoalContinuationMessage(message: UIMessage): boolean {
  const metadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readObjectRecord(metadata.cradle)
  const codexMetadata = readObjectRecord(cradleMetadata.codex)
  return codexMetadata.goalContinuation === true
}
