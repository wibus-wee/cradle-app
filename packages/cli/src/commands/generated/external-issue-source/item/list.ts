import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "external-issue-source",
    "item",
    "list"
  ],
  "description": "List external issue items",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID. Pass --all-workspaces to query every workspace.",
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true,
      "disableResolverFlag": "allWorkspaces"
    },
    {
      "name": "sourceKey",
      "required": false,
      "target": "query.sourceKey",
      "type": "string"
    },
    {
      "name": "syncStatus",
      "required": false,
      "target": "query.syncStatus",
      "type": "string",
      "values": [
        "active",
        "missing",
        "error"
      ]
    }
  ],
  "method": "get",
  "path": "/external-issue-sources/items"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
