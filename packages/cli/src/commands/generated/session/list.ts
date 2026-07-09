import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "list"
  ],
  "description": "List sessions",
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
      "name": "origin",
      "required": false,
      "target": "query.origin",
      "type": "string"
    },
    {
      "name": "sessionGroupId",
      "required": false,
      "target": "query.sessionGroupId",
      "type": "string"
    },
    {
      "name": "archived",
      "required": false,
      "target": "query.archived",
      "type": "boolean"
    }
  ],
  "method": "get",
  "path": "/sessions/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
