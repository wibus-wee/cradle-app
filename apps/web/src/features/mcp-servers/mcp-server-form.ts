import type { PostMcpServersData } from '~/api-gen/types.gen'

export type McpServerTransport = 'stdio' | 'streamable-http'
export type McpServerSaveBody = PostMcpServersData['body']

export function parseSecretValues(value: string): Record<string, string> {
  const entries = value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=')
      if (separator <= 0) {
        throw new Error('invalid-secret-line')
      }
      const key = line.slice(0, separator).trim()
      if (!key) {
        throw new Error('invalid-secret-line')
      }
      return [key, line.slice(separator + 1)] as const
    })
  return Object.fromEntries(entries)
}

export function parseArguments(value: string): string[] {
  return value.split('\n').map(argument => argument.trim()).filter(Boolean)
}
