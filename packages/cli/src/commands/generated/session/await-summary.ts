import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "await-summary"
  ],
  "description": "Get await summary for a session",
  "flags": [
    {
      "name": "sessionId",
      "required": true,
      "target": "query.sessionId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/session-awaits/summary"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
