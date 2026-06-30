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
    "queue"
  ],
  "description": "List pending and historical chat continuation queue items",
  "flags": [],
  "method": "get",
  "path": "/chat/sessions/{sessionId}/queue"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
