import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to CRADLE_CHAT_SESSION_ID.",
      "name": "sessionId",
      "required": true,
      "target": "path.sessionId",
      "type": "string",
      "envDefault": "CRADLE_CHAT_SESSION_ID"
    }
  ],
  "command": [
    "chat",
    "handoff",
    "get"
  ],
  "description": "Get handoff provenance for a destination session",
  "flags": [],
  "method": "get",
  "path": "/thread-handoffs/destination/{sessionId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
