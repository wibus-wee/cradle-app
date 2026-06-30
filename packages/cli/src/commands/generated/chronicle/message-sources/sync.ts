import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sourceId",
      "required": true,
      "target": "path.sourceId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "message-sources",
    "sync"
  ],
  "description": "Synchronize a Chronicle Slack source",
  "flags": [],
  "method": "post",
  "path": "/chronicle/message-sources/{sourceId}/sync"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
