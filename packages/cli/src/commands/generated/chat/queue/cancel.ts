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
    },
    {
      "name": "queueItemId",
      "required": true,
      "target": "path.queueItemId",
      "type": "string"
    }
  ],
  "command": [
    "chat",
    "queue",
    "cancel"
  ],
  "description": "Cancel a pending chat continuation queue item",
  "flags": [],
  "method": "delete",
  "path": "/chat/sessions/{sessionId}/queue/{queueItemId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
