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
    "queue",
    "reorder"
  ],
  "description": "Reorder pending chat continuation queue items",
  "flags": [
    {
      "name": "queueItemIds",
      "required": true,
      "target": "body.queueItemIds",
      "type": "string[]"
    }
  ],
  "method": "post",
  "path": "/chat/sessions/{sessionId}/queue/reorder"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
