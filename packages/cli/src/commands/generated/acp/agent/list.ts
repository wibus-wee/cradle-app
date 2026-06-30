import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "acp",
    "agent",
    "list"
  ],
  "description": "List installed agents",
  "flags": [],
  "method": "get",
  "path": "/acp/agents"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
