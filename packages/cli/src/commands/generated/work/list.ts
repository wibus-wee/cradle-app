import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "work",
    "list"
  ],
  "description": "List Work containers",
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
      "name": "linkedIssueId",
      "required": false,
      "target": "query.linkedIssueId",
      "type": "string"
    },
    {
      "name": "archived",
      "required": false,
      "target": "query.archived",
      "type": "boolean"
    },
    {
      "name": "cursor",
      "required": false,
      "target": "query.cursor",
      "type": "string"
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/works"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
