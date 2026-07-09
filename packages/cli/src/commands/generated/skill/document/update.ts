import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "document",
    "update"
  ],
  "description": "Update skill document",
  "flags": [
    {
      "name": "scope",
      "required": true,
      "target": "body.scope",
      "type": "string",
      "values": [
        "builtin",
        "legacy",
        "global",
        "repository",
        "workspace",
        "agent"
      ]
    },
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "document",
      "required": true,
      "target": "body.document",
      "type": "json"
    }
  ],
  "method": "put",
  "path": "/skills/document"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
