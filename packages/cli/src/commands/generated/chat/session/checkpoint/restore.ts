import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
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
    },
    {
      "name": "checkpointId",
      "required": true,
      "target": "path.checkpointId",
      "type": "string"
    }
  ],
  "command": [
    "chat",
    "session",
    "checkpoint",
    "restore"
  ],
  "description": "Restore the latest turn checkpoint and roll back its chat turn",
  "flags": [],
  "method": "post",
  "path": "/sessions/{id}/turn-checkpoints/{checkpointId}/restore"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
