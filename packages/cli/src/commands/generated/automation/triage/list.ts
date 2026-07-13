import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "automation",
    "triage",
    "list"
  ],
  "description": "List automation triage inbox",
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
      "name": "status",
      "required": false,
      "target": "query.status",
      "type": "string",
      "values": [
        "unread",
        "read",
        "resolved",
        "archived",
        "all"
      ]
    }
  ],
  "method": "get",
  "path": "/automation-triage/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
