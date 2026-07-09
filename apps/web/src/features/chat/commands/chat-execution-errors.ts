import { readJsonErrorCodeFromText } from './chat-response-command'

const KNOWN_CODES = new Set([
  'chat_session_executes_on_remote_host',
  'remote_cradle_server_not_connected',
  'remote_session_create_failed',
  'remote_session_delete_failed',
])

/**
 * Maps remote-execution / connection error codes to user-facing copy.
 * Returns null when the error is unrelated so callers can fall back.
 */
export function describeChatExecutionError(error: unknown): string | null {
  const code = readErrorCode(error)
  switch (code) {
    case 'chat_session_executes_on_remote_host':
      return 'This session runs on a remote host. Reopen it from Cradle so chat traffic is routed correctly.'
    case 'remote_cradle_server_not_connected':
      return 'The remote host is disconnected. Connect it before sending messages.'
    case 'remote_session_create_failed':
      return 'Could not create the remote session. Check the host connection and try again.'
    case 'remote_session_delete_failed':
      return 'Could not delete the remote session. Check the host connection and try again.'
    default:
      return null
  }
}

function readErrorCode(error: unknown): string | null {
  if (typeof error === 'string') {
    return readJsonErrorCodeFromText(error) ?? (KNOWN_CODES.has(error) ? error : null)
  }
  if (!error || typeof error !== 'object') {
    return null
  }
  const direct = (error as { code?: unknown }).code
  if (typeof direct === 'string') {
    return direct
  }
  const bodyText = (error as { bodyText?: unknown }).bodyText
  if (typeof bodyText === 'string') {
    return readJsonErrorCodeFromText(bodyText)
  }
  const message = (error as { message?: unknown }).message
  if (typeof message === 'string') {
    return readJsonErrorCodeFromText(message)
  }
  return null
}
