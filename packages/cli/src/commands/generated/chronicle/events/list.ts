import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "events",
    "list"
  ],
  "description": "List Chronicle realtime-compatible events",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    },
    {
      "name": "after",
      "required": false,
      "target": "query.after",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/chronicle/events"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
