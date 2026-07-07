import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "session-group",
    "delete"
  ],
  "description": "Delete session group",
  "flags": [],
  "method": "delete",
  "path": "/session-groups/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
