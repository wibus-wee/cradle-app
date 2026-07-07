import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "sessions",
    "recent"
  ],
  "description": "Get recent usage sessions",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/usage/sessions/recent"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
