import type { UIMessage } from 'ai'

import type { ChatRunState, PassiveRunStateInput } from '~/store/chat'

import type { ChatSessionMessageRow } from './use-chat-session-types'
import {
  derivePassiveStatus,
  isChatRunStateCancelling,
  isChatRunStateLocallyDriven,
  projectMainMessagesFromSnapshotRows,
  projectRowsWithoutEmptyStreamingAssistant,
  projectStreamingMainAssistantMessageIds,
  readLatestFailedMainAssistantRow,
  shouldHoldEmptyStreamingSnapshot,
} from './use-chat-session-types'

export interface SessionSnapshotProjectionInput {
  rows: ChatSessionMessageRow[]
  runState: ChatRunState
  existingMessageCount: number
  runtimeStatusKnown: boolean
  runtimeIdle: boolean
  runtimeActiveRunMessageId: string | null
  snapshotFetching: boolean
}

export interface SessionPassiveStreamProjectionInput {
  rows: ChatSessionMessageRow[] | undefined
  runState: ChatRunState | null
  runtimeStatusKnown: boolean
  runtimeIdle: boolean
  snapshotFetching: boolean
}

export interface ProjectedFailedMessage {
  messageId: string
  errorText: string
}

export interface StableSessionSnapshotProjection {
  messages: UIMessage[]
  passiveRunState: PassiveRunStateInput
  failedMessage: ProjectedFailedMessage | null
}

export interface SessionSnapshotProjection {
  messages: UIMessage[] | null
  passiveRunState: PassiveRunStateInput
  failedMessage: ProjectedFailedMessage | null
  holdEmptyStreamingSnapshot: boolean
  requestSnapshotRefresh: boolean
  snapshotStreamingMessageIds: string[]
}

export interface SessionPassiveStreamProjection {
  locallyDriven: boolean
  holdEmptyStreamingSnapshot: boolean
  snapshotStreamingMessageIds: string[]
}

export function deriveStableSessionSnapshotProjection(
  rows: ChatSessionMessageRow[],
): StableSessionSnapshotProjection {
  return {
    messages: projectMainMessagesFromSnapshotRows(rows),
    passiveRunState: {
      messageIds: [],
      cancelling: false,
      status: derivePassiveStatus(rows),
    },
    failedMessage: readFailedMessage(rows),
  }
}

export function deriveSessionSnapshotProjection(
  input: SessionSnapshotProjectionInput,
): SessionSnapshotProjection | null {
  if (isChatRunStateLocallyDriven(input.runState)) {
    return null
  }

  const holdEmptyStreamingSnapshot = shouldHoldEmptyStreamingSnapshot({
    rows: input.rows,
    runtimeStatusKnown: input.runtimeStatusKnown,
    runtimeIdle: input.runtimeIdle,
    snapshotFetching: input.snapshotFetching,
  })
  const effectiveRows = holdEmptyStreamingSnapshot
    ? projectRowsWithoutEmptyStreamingAssistant(input.rows)
    : input.rows
  const snapshotStreamingMessageIds = holdEmptyStreamingSnapshot
    ? []
    : projectStreamingMainAssistantMessageIds(effectiveRows)
  const passiveMessageIds = input.runtimeActiveRunMessageId
    ? [input.runtimeActiveRunMessageId]
    : snapshotStreamingMessageIds
  const passiveStatus = input.runtimeActiveRunMessageId
    ? 'streaming'
    : holdEmptyStreamingSnapshot
      ? 'idle'
      : derivePassiveStatus(effectiveRows)

  return {
    messages: !holdEmptyStreamingSnapshot || input.existingMessageCount === 0
      ? projectMainMessagesFromSnapshotRows(effectiveRows)
      : null,
    passiveRunState: {
      messageIds: passiveMessageIds,
      allowMissingMessage: Boolean(input.runtimeActiveRunMessageId),
      cancelling: isChatRunStateCancelling(input.runState) && passiveStatus === 'streaming',
      status: passiveStatus,
    },
    failedMessage: readFailedMessage(input.rows),
    holdEmptyStreamingSnapshot,
    requestSnapshotRefresh: holdEmptyStreamingSnapshot && input.runtimeIdle,
    snapshotStreamingMessageIds,
  }
}

export function deriveSessionPassiveStreamProjection(
  input: SessionPassiveStreamProjectionInput,
): SessionPassiveStreamProjection {
  const locallyDriven = input.runState ? isChatRunStateLocallyDriven(input.runState) : false
  if (!input.rows) {
    return {
      locallyDriven,
      holdEmptyStreamingSnapshot: false,
      snapshotStreamingMessageIds: [],
    }
  }

  const holdEmptyStreamingSnapshot = shouldHoldEmptyStreamingSnapshot({
    rows: input.rows,
    runtimeStatusKnown: input.runtimeStatusKnown,
    runtimeIdle: input.runtimeIdle,
    snapshotFetching: input.snapshotFetching,
  })
  return {
    locallyDriven,
    holdEmptyStreamingSnapshot,
    snapshotStreamingMessageIds: holdEmptyStreamingSnapshot
      ? []
      : projectStreamingMainAssistantMessageIds(input.rows),
  }
}

function readFailedMessage(rows: ChatSessionMessageRow[]): ProjectedFailedMessage | null {
  const failedRow = readLatestFailedMainAssistantRow(rows)
  return failedRow?.errorText
    ? { messageId: failedRow.messageId, errorText: failedRow.errorText }
    : null
}
