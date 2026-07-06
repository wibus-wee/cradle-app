import type { UIMessage } from 'ai'

import type { ChatRunState, PassiveRunStateInput } from '~/store/chat'

import type { ChatSessionMessageRow } from './use-chat-session-types'
import {
  derivePassiveStatus,
  isChatRunStateCancelling,
  isChatRunStateLocallyDriven,
  projectMainMessagesFromSnapshotRows,
  readLatestFailedMainAssistantRow,
} from './use-chat-session-types'

export interface SessionSnapshotProjectionInput {
  rows: ChatSessionMessageRow[]
  runState: ChatRunState
  existingMessageCount: number
  runtimeStatusKnown: boolean
  runtimeIdle: boolean
  runtimeActiveRunMessageId: string | null
}

export interface SessionPassiveStreamProjectionInput {
  runState: ChatRunState | null
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
  messages: UIMessage[]
  passiveRunState: PassiveRunStateInput
  failedMessage: ProjectedFailedMessage | null
  requestSnapshotRefresh: boolean
}

export interface SessionPassiveStreamProjection {
  locallyDriven: boolean
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

  const passiveMessageIds = input.runtimeActiveRunMessageId
    ? [input.runtimeActiveRunMessageId]
    : []
  const passiveStatus = input.runtimeActiveRunMessageId
    ? 'streaming'
    : derivePassiveStatus(input.rows)

  return {
    messages: projectMainMessagesFromSnapshotRows(input.rows),
    passiveRunState: {
      messageIds: passiveMessageIds,
      allowMissingMessage: Boolean(input.runtimeActiveRunMessageId),
      cancelling: isChatRunStateCancelling(input.runState) && passiveStatus === 'streaming',
      status: passiveStatus,
    },
    failedMessage: readFailedMessage(input.rows),
    requestSnapshotRefresh: false,
  }
}

export function deriveSessionPassiveStreamProjection(
  input: SessionPassiveStreamProjectionInput,
): SessionPassiveStreamProjection {
  const locallyDriven = input.runState ? isChatRunStateLocallyDriven(input.runState) : false
  return {
    locallyDriven,
  }
}

function readFailedMessage(rows: ChatSessionMessageRow[]): ProjectedFailedMessage | null {
  const failedRow = readLatestFailedMainAssistantRow(rows)
  return failedRow?.errorText
    ? { messageId: failedRow.messageId, errorText: failedRow.errorText }
    : null
}
