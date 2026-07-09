import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "await-list"
  ],
  "description": "List session awaits",
  "flags": [
    {
      "description": "Defaults to CRADLE_CHAT_SESSION_ID.",
      "name": "sessionId",
      "required": true,
      "target": "query.sessionId",
      "type": "string",
      "envDefault": "CRADLE_CHAT_SESSION_ID"
    }
  ],
  "method": "get",
  "path": "/session-awaits/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
