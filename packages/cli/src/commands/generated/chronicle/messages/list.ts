import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "messages",
    "list"
  ],
  "description": "List Chronicle message events",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/chronicle/messages"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
