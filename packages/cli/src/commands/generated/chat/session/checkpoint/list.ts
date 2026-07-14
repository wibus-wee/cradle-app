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
    }
  ],
  "command": [
    "chat",
    "session",
    "checkpoint",
    "list"
  ],
  "description": "List turn checkpoints for a chat session",
  "flags": [],
  "method": "get",
  "path": "/sessions/{id}/turn-checkpoints"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
