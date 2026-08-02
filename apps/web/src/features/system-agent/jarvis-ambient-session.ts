import type { RuntimeKind } from '~/features/agent-runtime/types'

const AMBIENT_SESSION_STORAGE_KEY = 'cradle:jarvis-ambient-session:v1'

interface JarvisAmbientSessionRecord {
  sessionId: string
}

export interface JarvisAmbientSessionPrefs {
  runtimeKind: RuntimeKind
  profileId: string
  modelId?: string
}

function readStoredAmbientSessionId(): string | null {
  try {
    const raw = localStorage.getItem(AMBIENT_SESSION_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as JarvisAmbientSessionRecord
    return typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0
      ? parsed.sessionId
      : null
  }
  catch {
    return null
  }
}

function storeAmbientSessionId(sessionId: string): void {
  const record: JarvisAmbientSessionRecord = { sessionId }
  localStorage.setItem(AMBIENT_SESSION_STORAGE_KEY, JSON.stringify(record))
}

/**
 * Create or resume the per-window Jarvis ambient observation session.
 * Never added to jarvis-ui-store.sessions — filtered from history by origin.
 */
export async function ensureJarvisAmbientSession(
  prefs: JarvisAmbientSessionPrefs,
): Promise<string> {
  const existing = readStoredAmbientSessionId()
  if (existing) {
    return existing
  }

  const { postSessions } = await import('~/api-gen/sdk.gen')
  const res = await postSessions({
    body: {
      workspaceId: null,
      title: 'Jarvis Ambient',
      origin: 'jarvis-ambient',
      providerTargetId: prefs.profileId,
      modelId: prefs.modelId,
      runtimeKind: prefs.runtimeKind,
    },
  })
  const session = res.data as { id?: string } | null
  if (!session?.id) {
    throw new Error('Failed to create Jarvis ambient session')
  }
  storeAmbientSessionId(session.id)
  return session.id
}

export function readJarvisAmbientSessionId(): string | null {
  return readStoredAmbientSessionId()
}

export function clearJarvisAmbientSessionId(): void {
  localStorage.removeItem(AMBIENT_SESSION_STORAGE_KEY)
}

export { AMBIENT_SESSION_STORAGE_KEY }
