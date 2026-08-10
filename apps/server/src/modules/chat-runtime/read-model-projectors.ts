import type { BackendRunSnapshotEvent } from '@cradle/db'

import type { ChatRuntimeWriteDb } from './es/event-store'

type ReadModelProjectionDb = Pick<ChatRuntimeWriteDb, 'delete' | 'insert' | 'select' | 'update'>

export interface ChatRuntimeReadModelProjector {
  projectMessage?: (
    db: ReadModelProjectionDb,
    input: { messageId: string, isMeta?: boolean },
  ) => void
  projectRun?: (db: ReadModelProjectionDb, input: { runId: string }) => void
  projectRunSnapshotEvent?: (
    db: ReadModelProjectionDb,
    input: { sourceEvent: BackendRunSnapshotEvent, workspaceId: string | null },
  ) => void
}

const readModelProjectors = new Set<ChatRuntimeReadModelProjector>()

export function registerChatRuntimeReadModelProjector(
  projector: ChatRuntimeReadModelProjector,
): () => void {
  readModelProjectors.add(projector)
  return () => readModelProjectors.delete(projector)
}

export function projectChatRuntimeMessageReadModels(
  db: ReadModelProjectionDb,
  input: { messageId: string, isMeta?: boolean },
): void {
  for (const projector of readModelProjectors) {
    projector.projectMessage?.(db, input)
  }
}

export function projectChatRuntimeRunReadModels(
  db: ReadModelProjectionDb,
  input: { runId: string },
): void {
  for (const projector of readModelProjectors) {
    projector.projectRun?.(db, input)
  }
}

export function projectChatRuntimeRunSnapshotEventReadModels(
  db: ReadModelProjectionDb,
  input: { sourceEvent: BackendRunSnapshotEvent, workspaceId: string | null },
): void {
  if (!input.sourceEvent.toolCallId) {
    return
  }
  for (const projector of readModelProjectors) {
    projector.projectRunSnapshotEvent?.(db, input)
  }
}
