import { getServerUrl } from '~/lib/electron'
import { cradleFetch } from '~/lib/server-credential'

export interface ChatArtifactRecord {
  id: string
  sessionId: string
  title: string
  source: string
  revision: number
  createdAt: number
  updatedAt: number
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    let message = fallbackMessage
    try {
      const body = await response.json() as { message?: string }
      if (typeof body.message === 'string' && body.message.trim()) {
        message = body.message
      }
    }
    catch {
      // keep fallback
    }
    throw new Error(message)
  }
  return await response.json() as T
}

/** Fetch one Artifact by session + id (latest revision from server). */
export async function getChatArtifact(
  sessionId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<ChatArtifactRecord> {
  const url = new URL(
    `/chat-artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`,
    getServerUrl(),
  )
  const response = await cradleFetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  })
  return readJson(response, 'Failed to load artifact')
}

export async function listChatArtifacts(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ChatArtifactRecord[]> {
  const url = new URL(
    `/chat-artifacts/${encodeURIComponent(sessionId)}`,
    getServerUrl(),
  )
  const response = await cradleFetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  })
  return readJson(response, 'Failed to list artifacts')
}
