import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "milestone",
    "list"
  ],
  "description": "List issue milestones",
  "flags": [
    {
      "description": "Defaults to CRADLE_WORKSPACE_ID. Pass --all-workspaces to query every workspace.",
      "name": "workspaceId",
      "required": false,
      "target": "query.workspaceId",
      "type": "string",
      "envDefault": "CRADLE_WORKSPACE_ID",
      "disableEnvDefaultFlag": "allWorkspaces"
    }
  ],
  "method": "get",
  "path": "/issues/milestones"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
