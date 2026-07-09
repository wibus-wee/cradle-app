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
    },
    {
      "name": "worktreeId",
      "required": true,
      "target": "path.worktreeId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "worktree",
    "cleanup"
  ],
  "description": "Cleanup managed worktree",
  "flags": [
    {
      "name": "mode",
      "required": true,
      "target": "body.mode",
      "type": "string",
      "values": [
        "merge-and-close",
        "abandon"
      ]
    },
    {
      "name": "targetBranch",
      "required": false,
      "target": "body.targetBranch",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/worktrees/{worktreeId}/cleanup"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
