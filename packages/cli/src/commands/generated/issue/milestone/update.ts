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
    "milestone",
    "update"
  ],
  "description": "Update issue milestone",
  "flags": [
    {
      "name": "title",
      "required": false,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "description",
      "required": false,
      "target": "body.description",
      "type": "string"
    },
    {
      "name": "dueDate",
      "required": false,
      "target": "body.dueDate",
      "type": "number"
    },
    {
      "name": "status",
      "required": false,
      "target": "body.status",
      "type": "string",
      "values": [
        "open",
        "closed"
      ]
    }
  ],
  "method": "patch",
  "path": "/issues/milestones/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
