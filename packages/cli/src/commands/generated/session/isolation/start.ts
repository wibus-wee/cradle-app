import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to CRADLE_CHAT_SESSION_ID.",
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string",
      "envDefault": "CRADLE_CHAT_SESSION_ID"
    }
  ],
  "command": [
    "session",
    "isolation",
    "start"
  ],
  "description": "Start session isolation",
  "flags": [
    {
      "name": "slug",
      "required": false,
      "target": "body.slug",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/sessions/{id}/isolation/start"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
