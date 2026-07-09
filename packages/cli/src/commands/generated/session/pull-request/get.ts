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
    "pull-request",
    "get"
  ],
  "description": "Get session-bound GitHub pull request",
  "flags": [],
  "method": "get",
  "path": "/sessions/{id}/pull-request"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
