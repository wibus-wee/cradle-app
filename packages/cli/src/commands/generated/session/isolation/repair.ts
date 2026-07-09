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
    "repair"
  ],
  "description": "Recreate missing isolated checkout for session",
  "flags": [],
  "method": "post",
  "path": "/sessions/{id}/isolation/repair"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
