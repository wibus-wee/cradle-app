import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "background-job",
    "list"
  ],
  "description": "List background jobs",
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
      "name": "ownerNamespace",
      "required": false,
      "target": "query.ownerNamespace",
      "type": "string"
    },
    {
      "name": "ownerResourceType",
      "required": false,
      "target": "query.ownerResourceType",
      "type": "string"
    },
    {
      "name": "ownerResourceId",
      "required": false,
      "target": "query.ownerResourceId",
      "type": "string"
    },
    {
      "name": "ownerResourceKey",
      "required": false,
      "target": "query.ownerResourceKey",
      "type": "string"
    },
    {
      "name": "kind",
      "required": false,
      "target": "query.kind",
      "type": "string"
    },
    {
      "name": "status",
      "required": false,
      "target": "query.status",
      "type": "string",
      "values": [
        "pending",
        "running",
        "succeeded",
        "failed",
        "cancelled"
      ]
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/background-jobs/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
