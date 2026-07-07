import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session-group",
    "list"
  ],
  "description": "List session groups",
  "flags": [
    {
      "description": "Defaults to CRADLE_WORKSPACE_ID. Pass --all-workspaces to query every workspace.",
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string",
      "envDefault": "CRADLE_WORKSPACE_ID",
      "disableEnvDefaultFlag": "allWorkspaces"
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
    }
  ],
  "method": "get",
  "path": "/session-groups"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
