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
    "retry"
  ],
  "description": "Retry the exact failed input after runtime authentication succeeds",
  "flags": [],
  "method": "post",
  "path": "/chat/sessions/{sessionId}/auth-recovery/retry"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
