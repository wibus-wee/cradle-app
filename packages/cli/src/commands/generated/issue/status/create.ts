import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "status",
    "create"
  ],
  "description": "Create issue status",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "color",
      "required": false,
      "target": "body.color",
      "type": "string"
    },
    {
      "name": "category",
      "required": false,
      "target": "body.category",
      "type": "string",
      "values": [
        "triage",
        "backlog",
        "unstarted",
        "started",
        "completed",
        "canceled"
      ]
    }
  ],
  "method": "post",
  "path": "/issues/statuses"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
