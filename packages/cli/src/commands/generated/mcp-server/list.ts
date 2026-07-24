import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "mcp-server",
    "list"
  ],
  "description": "List custom MCP servers",
  "flags": [],
  "method": "get",
  "path": "/mcp-servers/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
