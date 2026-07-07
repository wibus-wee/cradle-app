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
    "session-group",
    "update"
  ],
  "description": "Update session group",
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
      "name": "linkedIssueId",
      "required": false,
      "target": "body.linkedIssueId",
      "type": "string"
    },
    {
      "name": "archived",
      "required": false,
      "target": "body.archived",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/session-groups/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
