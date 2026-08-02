import { AMBIENT_OBSERVATION_LIMIT } from '~/features/activity/types'

import { readRecentAmbientObservationTexts } from './activity-jarvis-bridge'
import { formatContextEnvelopeForAgent } from './format-context'
import { readJarvisAmbientSessionId } from './jarvis-ambient-session'
import { collectContextEnvelope } from './use-context-snapshot'

function readObservationTextFromMessage(message: {
  parts: Array<{ type: string, [key: string]: unknown }>
  metadata?: unknown
}): string | null {
  const metadata = message.metadata as { cradle?: { observation?: { kind?: string } } } | undefined
  if (metadata?.cradle?.observation?.kind !== 'ui-activity') {
    return null
  }

  for (const part of message.parts) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
      return part.text.trim()
    }
  }
  return null
}

async function loadAmbientObservationTextsFromSession(): Promise<string[]> {
  const sessionId = readJarvisAmbientSessionId()
  if (!sessionId) {
    return []
  }

  const { getChatSessionsBySessionIdMessages } = await import('~/api-gen/sdk.gen')
  const res = await getChatSessionsBySessionIdMessages({
    path: { sessionId },
    query: { limit: 50 },
  })
  if (res.error || !res.data?.rows) {
    return []
  }

  const texts = res.data.rows
    .map(row => readObservationTextFromMessage(row.message))
    .filter((text): text is string => text !== null)

  return texts.slice(-AMBIENT_OBSERVATION_LIMIT)
}

/** Build Jarvis user prompt text: ambient observations, then live cradle_context, then text. */
export async function buildJarvisPromptText(
  text: string,
  includeContext: boolean,
): Promise<string> {
  const envelope = collectContextEnvelope()
  const contextItems = includeContext
    ? envelope.items
    : envelope.items.filter(item => item.id.startsWith('explicit:'))
  const contextBlock = contextItems.length > 0
    ? formatContextEnvelopeForAgent({ ...envelope, items: contextItems })
    : ''

  let ambientObservations: string[] = []
  if (includeContext) {
    const cached = readRecentAmbientObservationTexts()
    const persisted = await loadAmbientObservationTextsFromSession()
    ambientObservations = [...new Set([...persisted, ...cached])].slice(-AMBIENT_OBSERVATION_LIMIT)
  }
  const observationBlock = ambientObservations.join('\n')

  const parts = [observationBlock, contextBlock, text].filter(part => part.length > 0)
  return parts.join('\n\n')
}
