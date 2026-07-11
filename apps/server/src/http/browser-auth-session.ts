import { createHash, randomBytes } from 'node:crypto'

const COOKIE_NAME = 'cradle-session'
const SESSION_TTL_SECONDS = 12 * 60 * 60
const sessions = new Map<string, number>()

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function prune(now: number): void {
  for (const [key, expiresAt] of sessions) {
    if (expiresAt <= now) {
      sessions.delete(key)
    }
  }
}

export function issueBrowserAuthSession(secure: boolean, now = Date.now()): string {
  prune(now)
  const token = randomBytes(32).toString('base64url')
  sessions.set(digest(token), now + SESSION_TTL_SECONDS * 1_000)
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ')
}

export function verifyBrowserAuthSession(headers: Headers, now = Date.now()): boolean {
  const cookies = headers.get('cookie')?.split(';') ?? []
  const token = cookies
    .map(cookie => cookie.trim().split('='))
    .find(([name]) => name === COOKIE_NAME)?.[1]
  if (!token) {
    return false
  }
  const expiresAt = sessions.get(digest(token))
  return Boolean(expiresAt && expiresAt > now)
}
