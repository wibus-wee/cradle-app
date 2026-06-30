import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "cancel"
  ],
  "description": "Cancel active run for session",
  "flags": [],
  "method": "post",
  "path": "/chat/sessions/{sessionId}/cancel"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
