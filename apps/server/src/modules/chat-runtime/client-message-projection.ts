import type { UIMessage, UIMessageChunk } from 'ai'

import { readOptionalObjectRecord } from '../../helpers/json-record'

interface ClientMetadataProjection {
  changed: boolean
  metadata: unknown
}

function projectClientMessageMetadata(metadata: unknown): ClientMetadataProjection {
  const metadataRecord = readOptionalObjectRecord(metadata)
  const codexMetadata = readOptionalObjectRecord(metadataRecord?.codex)
  if (!metadataRecord || !codexMetadata || !Object.hasOwn(codexMetadata, 'responseItems')) {
    return { changed: false, metadata }
  }

  const { responseItems: _responseItems, ...clientCodexMetadata } = codexMetadata
  const clientMetadata = { ...metadataRecord }
  if (Object.keys(clientCodexMetadata).length > 0) {
    clientMetadata.codex = clientCodexMetadata
  }
  else {
    delete clientMetadata.codex
  }

  return {
    changed: true,
    metadata: Object.keys(clientMetadata).length > 0 ? clientMetadata : undefined,
  }
}

/**
 * Removes provider-private reconstruction state before a durable message crosses
 * the server/client boundary. The stored message remains lossless so provider
 * runtimes can reconstruct exact native history on later turns.
 */
export function projectChatMessageForClient<TMessage extends UIMessage>(message: TMessage): TMessage {
  const projection = projectClientMessageMetadata(message.metadata)
  if (!projection.changed) {
    return message
  }

  if (projection.metadata === undefined) {
    const { metadata: _metadata, ...clientMessage } = message
    return clientMessage as TMessage
  }

  return { ...message, metadata: projection.metadata } as TMessage
}

/**
 * Applies the same ownership boundary to live chunks before they enter replay
 * buffers or renderer subscriptions. A private-only metadata chunk has no
 * client-visible meaning and is omitted.
 */
export function projectChatChunkForClient(chunk: UIMessageChunk): UIMessageChunk | null {
  if (
    chunk.type !== 'start'
    && chunk.type !== 'finish'
    && chunk.type !== 'message-metadata'
  ) {
    return chunk
  }

  const projection = projectClientMessageMetadata(chunk.messageMetadata)
  if (!projection.changed) {
    return chunk
  }

  if (projection.metadata !== undefined) {
    return { ...chunk, messageMetadata: projection.metadata } as UIMessageChunk
  }

  if (chunk.type === 'message-metadata') {
    return null
  }

  const { messageMetadata: _messageMetadata, ...clientChunk } = chunk
  return clientChunk as UIMessageChunk
}
