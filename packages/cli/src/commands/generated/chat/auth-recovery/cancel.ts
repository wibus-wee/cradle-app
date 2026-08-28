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
    "auth-recovery",
    "cancel"
  ],
  "description": "Dismiss a pending runtime authentication recovery",
  "flags": [],
  "method": "delete",
  "path": "/chat/sessions/{sessionId}/auth-recovery"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
