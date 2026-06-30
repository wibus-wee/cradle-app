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
    "external-issue-source",
    "item",
    "move"
  ],
  "description": "Update external issue item status",
  "flags": [
    {
      "name": "statusId",
      "required": true,
      "target": "body.statusId",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/external-issue-sources/items/{id}/status"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
