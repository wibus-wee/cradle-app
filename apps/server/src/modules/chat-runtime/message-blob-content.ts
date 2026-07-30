import { chatMessageBlobRefs } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { readBlobBytes } from '../blob-store/service'

/**
 * Read a chat-owned blob only through a session that references it.
 *
 * The session scope is part of the HTTP route so linked-session proxying can
 * forward the same request to the Cradle server that owns the remote session.
 */
export async function readSessionMessageBlob(
  sessionId: string,
  blobId: string,
): Promise<{
  bytes: Buffer
  mediaType: string
  byteSize: number
}> {
  const reference = db()
    .select({
      id: chatMessageBlobRefs.id,
    })
    .from(chatMessageBlobRefs)
    .where(and(
      eq(chatMessageBlobRefs.sessionId, sessionId),
      eq(chatMessageBlobRefs.blobId, blobId),
    ))
    .limit(1)
    .get()

  if (!reference) {
    throw new AppError({
      code: 'chat_message_blob_not_found',
      status: 404,
      message: 'Chat message blob not found',
      details: { sessionId, blobId },
    })
  }

  return await readBlobBytes(blobId)
}
