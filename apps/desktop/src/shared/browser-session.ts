const BROWSER_SESSION_PARTITION = 'persist:cradle-browser'

export function browserSessionPartition(ownerId: string): string {
  return `${BROWSER_SESSION_PARTITION}-${Buffer.from(ownerId).toString('base64url')}`
}
