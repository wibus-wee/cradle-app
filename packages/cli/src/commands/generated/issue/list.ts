import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "list"
  ],
  "description": "List issues",
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
      "name": "milestoneId",
      "required": false,
      "target": "query.milestoneId",
      "type": "string"
    },
    {
      "name": "parentIssueId",
      "required": false,
      "target": "query.parentIssueId",
      "type": "string"
    },
    {
      "name": "priority",
      "required": false,
      "target": "query.priority",
      "type": "string"
    },
    {
      "name": "labels",
      "required": false,
      "target": "query.labels",
      "type": "string[]"
    },
    {
      "name": "statusId",
      "required": false,
      "target": "query.statusId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/issues/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
