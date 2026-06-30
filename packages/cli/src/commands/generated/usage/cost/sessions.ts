import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "cost",
    "sessions"
  ],
  "description": "Get per-session cost breakdown",
  "flags": [
    {
      "name": "from",
      "required": false,
      "target": "query.from",
      "type": "string"
    },
    {
      "name": "to",
      "required": false,
      "target": "query.to",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/usage/cost/sessions"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
