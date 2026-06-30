import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "daily"
  ],
  "description": "Get daily usage",
  "flags": [
    {
      "name": "days",
      "required": false,
      "target": "query.days",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/usage/daily"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
