import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "automation",
    "create"
  ],
  "description": "Create automation",
  "flags": [
    {
      "name": "id",
      "required": false,
      "target": "body.id",
      "type": "string"
    },
    {
      "description": "Defaults to CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "envDefault": "CRADLE_WORKSPACE_ID"
    },
    {
      "name": "title",
      "required": true,
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
      "name": "enabled",
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "trigger",
      "required": true,
      "target": "body.trigger",
      "type": "json"
    },
    {
      "name": "recipe",
      "required": true,
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
  "method": "post",
  "path": "/automations/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
