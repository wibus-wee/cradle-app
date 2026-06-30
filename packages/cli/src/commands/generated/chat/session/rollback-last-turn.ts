import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sessionId",
      "required": true,
      "target": "path.sessionId",
      "type": "string"
    }
  ],
  "command": [
    "chat",
    "session",
    "rollback-last-turn"
  ],
  "description": "Roll back the last completed chat turn",
  "flags": [],
  "method": "post",
  "path": "/chat/sessions/{sessionId}/rollback-last-turn"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
