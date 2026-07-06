import {
  backendRuns,
  chatSessionQueueItems,
  messages
} from '@cradle/db'
import { eq } from 'drizzle-orm'

import { db } from '../../../infra'
import { readSessionEvents } from './event-store'
import {
  checkChatSessionProjectionParity,
  type ChatEsParityReport
} from './parity'
import { projectSessionEvent } from './projectors'
import { runSessionActorTask } from './session-actor'

export interface ChatSessionProjectionRebuildResult {
  sessionId: string
  eventsReplayed: number
  parity: ChatEsParityReport
}

export async function rebuildSessionProjections(
  sessionId: string
): Promise<ChatSessionProjectionRebuildResult> {
  return await runSessionActorTask(sessionId, () => rebuildSessionProjectionsInActor(sessionId))
}

function rebuildSessionProjectionsInActor(sessionId: string): ChatSessionProjectionRebuildResult {
  let eventsReplayed = 0
  db().transaction((tx) => {
    const events = readSessionEvents(sessionId, tx)
    eventsReplayed = events.length

    tx.delete(chatSessionQueueItems)
      .where(eq(chatSessionQueueItems.sessionId, sessionId))
      .run()
    tx.delete(backendRuns)
      .where(eq(backendRuns.chatSessionId, sessionId))
      .run()
    tx.delete(messages)
      .where(eq(messages.sessionId, sessionId))
      .run()

    for (const event of events) {
      projectSessionEvent(tx, event)
    }
  })

  return {
    sessionId,
    eventsReplayed,
    parity: checkChatSessionProjectionParity(sessionId)
  }
}
