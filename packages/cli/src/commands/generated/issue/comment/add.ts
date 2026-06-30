import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
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
    "issue",
    "comment",
    "add"
  ],
  "description": "Add issue comment",
  "flags": [
    {
      "name": "content",
      "required": true,
      "target": "body.content",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/issues/{id}/comments"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
