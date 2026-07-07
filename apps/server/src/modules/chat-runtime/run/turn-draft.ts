import { randomUUID } from 'node:crypto'

import type { BackendRun } from '@cradle/db'
import type { FileUIPart, UIMessage } from 'ai'

import { readObjectRecord } from '../../../helpers/json-record'
import { currentUnixSeconds } from '../../../helpers/time'
import { readDurableProviderRuntimeBinding } from '../../provider-runtime/service'
import type { ChatContextPart } from '../context-parts'
import { commitSessionEvents } from '../es/commands'
import type { BackendRunStartedFact } from '../es/events'
import type { ChatSessionContinuationMode } from '../queue/session-queue'
import type { RuntimeGoalContinuation } from '../runtime-provider-types'
import {
  annotateGoalMessage,
  createUserMessage,
  extractMessageText,
} from '../ui-message'

interface ContinuationMetadataInput {
  mode: ChatSessionContinuationMode
  queueItemId?: string
  sourceMessageId?: string
  splitParts?: UIMessage['parts']
}

export interface DraftTurnInput {
  sessionId: string
  userText: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  goalContinuation?: RuntimeGoalContinuation
  continuation?: { mode: ChatSessionContinuationMode, queueItemId?: string }
}

export interface DraftTurnFromUserMessageInput {
  sessionId: string
  userMessage: UIMessage
  continuation?: { mode: ChatSessionContinuationMode, queueItemId?: string }
}

export interface DraftTurnResult {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
}

export interface InsertCompletedUserMessageInput {
  sessionId: string
  message: UIMessage
  parentMessageId?: string | null
}

export interface StartRunInput {
  sessionId: string
  messageId: string
  origin: 'user' | 'issue-agent' | 'system'
  assistantMessage: UIMessage
  queueItemId?: string | null
}

export function annotateContinuationMessage(
  message: UIMessage,
  continuation: ContinuationMetadataInput | null,
): UIMessage {
  if (!continuation) {
    return message
  }

  const currentMetadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const currentCradleMetadata = readObjectRecord(currentMetadata.cradle)

  return {
    ...message,
    metadata: {
      ...currentMetadata,
      cradle: {
        ...currentCradleMetadata,
        continuation: {
          mode: continuation.mode,
          ...(continuation.queueItemId ? { queueItemId: continuation.queueItemId } : {}),
          ...(continuation.sourceMessageId
            ? { sourceMessageId: continuation.sourceMessageId }
            : {}),
          ...(continuation.splitParts !== undefined ? { splitParts: continuation.splitParts } : {}),
        },
      },
    },
  } as UIMessage
}

export async function createDraftTurn(input: DraftTurnInput): Promise<DraftTurnResult> {
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const goalObjective
    = input.goalContinuation?.readGoalCommandObjective?.({ text: input.userText }) ?? null
  const userText = goalObjective ?? input.userText
  const userMessage = annotateContinuationMessage(
    goalObjective
      ? annotateGoalMessage(
          createUserMessage(userMessageId, userText, input.files, input.contextParts),
          goalObjective,
        )
      : createUserMessage(userMessageId, userText, input.files, input.contextParts),
    input.continuation ?? null,
  )
  const userContent = extractMessageText(userMessage)

  await commitSessionEvents(input.sessionId, [
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: userMessageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: userContent,
          messageJson: JSON.stringify(userMessage),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  ])

  return { userMessageId, assistantMessageId, userMessage }
}

export async function createDraftTurnFromUserMessage(
  input: DraftTurnFromUserMessageInput,
): Promise<DraftTurnResult> {
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const userMessage = annotateContinuationMessage(input.userMessage, input.continuation ?? null)

  await commitSessionEvents(input.sessionId, [
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: userMessage.id,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(userMessage),
          messageJson: JSON.stringify(userMessage),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  ])

  return { userMessageId: userMessage.id, assistantMessageId, userMessage }
}

export async function insertCompletedUserMessage(
  input: InsertCompletedUserMessageInput,
): Promise<void> {
  const now = currentUnixSeconds()
  await commitSessionEvents(input.sessionId, [
    {
      type: 'SteerApplied',
      payload: {
        message: {
          id: input.message.id,
          sessionId: input.sessionId,
          parentMessageId: input.parentMessageId ?? null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(input.message),
          messageJson: JSON.stringify(input.message),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  ])
}

export async function startRun(input: StartRunInput): Promise<BackendRun> {
  const binding = readDurableProviderRuntimeBinding(input.sessionId)
  const now = currentUnixSeconds()
  const run = {
    id: randomUUID(),
    bindingId: binding?.id ?? null,
    chatSessionId: input.sessionId,
    messageId: input.messageId,
    origin: input.origin,
    status: 'streaming',
    stopReason: null,
    errorText: null,
    startedAt: now,
    finishedAt: null,
  } satisfies BackendRunStartedFact
  await commitSessionEvents(input.sessionId, [
    {
      type: 'RunStarted',
      payload: {
        run,
        assistantMessage: {
          id: input.messageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: extractMessageText(input.assistantMessage),
          messageJson: JSON.stringify(input.assistantMessage),
          errorText: null,
          createdAt: now,
          updatedAt: now,
        },
        queueItemId: input.queueItemId ?? null,
      },
    },
  ])
  return run
}
