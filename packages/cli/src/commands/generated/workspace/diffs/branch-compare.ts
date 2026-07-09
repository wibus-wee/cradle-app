import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "branch-compare"
  ],
  "description": "Create or refresh local branch compare diff review",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "body.repo",
      "type": "string"
    },
    {
      "name": "baseRef",
      "required": true,
      "target": "body.baseRef",
      "type": "string"
    },
    {
      "name": "headRef",
      "required": true,
      "target": "body.headRef",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/diff-reviews/local-branch-compare"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
