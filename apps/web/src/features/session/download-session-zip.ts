// Downloads a session as a ZIP archive (session.json + transcript.md) by
// streaming from GET /sessions/:id/export/zip. Uses cradleFetch directly so the
// Bearer auth token + credentials are injected exactly as the generated client
// does, and reads the filename from Content-Disposition. Throws with a useful
// message on 404 (not found) / 409 (still streaming) so the caller can toast.
import { getServerUrl } from '~/lib/electron'
import { cradleFetch } from '~/lib/server-credential'

function parseFilenameFromDisposition(disposition: string): string | null {
  // RFC 6266: prefer filename*=UTF-8''<percent-encoded>, fall back to filename="...".
  const utf8Match = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''))
    }
    catch {
      return utf8Match[1].trim()
    }
  }
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return match?.[1]?.trim() ?? null
}

export async function downloadSessionZip(sessionId: string): Promise<void> {
  const url = new URL(`/sessions/${encodeURIComponent(sessionId)}/export/zip`, getServerUrl())
  const response = await cradleFetch(url)
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error('session-export-busy')
    }
    if (response.status === 404) {
      throw new Error('session-not-found')
    }
    throw new Error(`session-export-failed-${response.status}`)
  }

  const blob = await response.blob()
  const filename
    = parseFilenameFromDisposition(response.headers.get('content-disposition') ?? '')
    ?? `cradle-session-${sessionId}.zip`

  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
