/** Composer bang (`!`) opens a temporary Cradle PTY — helpers shared by View/Container. */

export const COMPOSER_BANG_PTY_COMMAND_LABEL = 'interactive shell'
export const COMPOSER_BANG_PTY_MAX_TRANSCRIPT_CHARS = 100 * 1024
export const COMPOSER_BANG_PTY_HEIGHT_PX = 220

/** Stable shell pty id scoped to a chat session. */
export function composerBangPtyId(sessionId: string): string {
  return `terminal:composer-bang:${sessionId}`
}

/**
 * Door detection: the draft starts with `!` and is otherwise a bang-mode candidate
 * (no attachments / context). Once open, the composer no longer keeps the `!`.
 */
export function isComposerBangPtyDoor(text: string): boolean {
  const normalized = text.trimStart()
  return normalized.startsWith('!')
}

/**
 * True when scrubbed transcript has user-visible shell content beyond an empty prompt.
 * Used to decide whether discard needs confirmation.
 */
export function bangPtyTranscriptHasOutput(transcript: string): boolean {
  const plain = transcript
    .replace(/\r/g, '')
    .replace(/\0/g, '')
    .trim()
  if (!plain) {
    return false
  }
  // Single-line prompts like "user@host:~/proj$" or "%" with no command body.
  const lines = plain.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    return false
  }
  if (lines.length === 1) {
    const line = lines[0] ?? ''
    // Empty-looking prompt endings without a following command payload.
    if (/[$#%>]\s*$/.test(line) && !/\n/.test(plain)) {
      return false
    }
  }
  return true
}
