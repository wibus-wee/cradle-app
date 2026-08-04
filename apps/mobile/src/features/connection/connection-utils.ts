export function normalizeServerUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`
  return new URL(withProtocol).origin
}
