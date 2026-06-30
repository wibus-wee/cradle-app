import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "session",
    "archive"
  ],
  "description": "Archive or restore session",
  "flags": [
    {
      "name": "archived",
      "required": true,
      "target": "body.archived",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/sessions/{id}/archive"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
