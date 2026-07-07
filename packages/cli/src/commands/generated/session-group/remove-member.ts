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
    },
    {
      "name": "sessionId",
      "required": true,
      "target": "path.sessionId",
      "type": "string"
    }
  ],
  "command": [
    "session-group",
    "remove-member"
  ],
  "description": "Remove session from session group",
  "flags": [],
  "method": "delete",
  "path": "/session-groups/{id}/members/{sessionId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
