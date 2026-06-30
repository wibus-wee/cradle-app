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
    "automation",
    "update"
  ],
  "description": "Update automation",
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
      "name": "trigger",
      "required": false,
      "target": "body.trigger",
      "type": "json"
    },
    {
      "name": "recipe",
      "required": false,
      "target": "body.recipe",
      "type": "json"
    },
    {
      "name": "createdByKind",
      "required": false,
      "target": "body.createdByKind",
      "type": "string",
      "values": [
        "agent",
        "user",
        "system"
      ]
    },
    {
      "name": "createdById",
      "required": false,
      "target": "body.createdById",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/automations/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
