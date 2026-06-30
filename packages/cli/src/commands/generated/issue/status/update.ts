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
    "status",
    "update"
  ],
  "description": "Update issue status",
  "flags": [
    {
      "name": "name",
      "required": false,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "color",
      "required": false,
      "target": "body.color",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/issues/statuses/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
