import type { NewMessage } from '@cradle/db'
import { messages } from '@cradle/db'

import type { ChatRuntimeWriteDb } from '../../src/modules/chat-runtime/es/event-store'
import {
  putMessagePayload,
  toMessageProjectionValues,
} from '../../src/modules/chat-runtime/message-payload-store'

export type MessageFixture = Omit<NewMessage, 'payloadId'> & {
  content: string
  messageJson: string
  errorText?: string | null
}

export function insertMessageFixtures(
  database: ChatRuntimeWriteDb,
  fixtures: MessageFixture | MessageFixture[],
): void {
  const rows = Array.isArray(fixtures) ? fixtures : [fixtures]
  const projectionRows = rows.map((fixture) => {
    const createdAt = fixture.createdAt ?? Math.floor(Date.now() / 1000)
    const updatedAt = fixture.updatedAt ?? createdAt
    const source = {
      ...fixture,
      parentMessageId: fixture.parentMessageId ?? null,
      parentToolCallId: fixture.parentToolCallId ?? null,
      taskId: fixture.taskId ?? null,
      depth: fixture.depth ?? 0,
      status: fixture.status ?? 'complete',
      errorText: fixture.errorText ?? null,
      createdAt,
      updatedAt,
    }
    putMessagePayload(database, source)
    return toMessageProjectionValues(source)
  })

  database.insert(messages).values(projectionRows).run()
}
