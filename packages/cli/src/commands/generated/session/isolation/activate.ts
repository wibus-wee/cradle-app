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
    "activate"
  ],
  "description": "Activate pending session isolation",
  "flags": [
    {
      "name": "mode",
      "required": true,
      "target": "body.mode",
      "type": "string",
      "values": [
        "migrate",
        "leave-main",
        "cancel"
      ]
    }
  ],
  "method": "post",
  "path": "/sessions/{id}/isolation/activate"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
