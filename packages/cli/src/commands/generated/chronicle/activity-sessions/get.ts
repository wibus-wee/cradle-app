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
    "chronicle",
    "activity-sessions",
    "get"
  ],
  "description": "Get a Chronicle activity session",
  "flags": [],
  "method": "get",
  "path": "/chronicle/activity-sessions/{sessionId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
