const DEFAULT_API_URL = 'http://127.0.0.1:14242'

export function deriveMcpUrl(apiUrl: string): string {
  return `${apiUrl.trim().replace(/\/+$/, '') || DEFAULT_API_URL}/mcp`
}
