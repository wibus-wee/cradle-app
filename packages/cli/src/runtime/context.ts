import { requestJson } from './http-client'
import type { CliHttpMethod, CommandContext } from './types'

interface CommanderNode {
  parent: CommanderNode | null
  getOptionValue: (name: string) => unknown
}

interface CreateCommandContextInput {
  serverUrl: string
}

export function createCommandContext(input: CreateCommandContextInput): CommandContext {
  return {
    serverUrl: input.serverUrl,
    request(operation: {
      body?: unknown
      method: CliHttpMethod
      path: Record<string, unknown>
      query: Record<string, unknown>
      template: string
    }) {
      return requestJson({ ...operation, serverUrl: input.serverUrl })
    },
  }
}

export function getCommandContext(command: CommanderNode): CommandContext {
  let root = command
  while (root.parent) {
    root = root.parent
  }

  const context = root.getOptionValue('__context')
  if (!context) {
    throw new Error('Command context was not initialized')
  }
  return context as CommandContext
}
