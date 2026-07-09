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
    "worktree",
    "create"
  ],
  "description": "Create managed worktree",
  "flags": [
    {
      "name": "sessionId",
      "required": true,
      "target": "body.sessionId",
      "type": "string"
    },
    {
      "name": "slug",
      "required": false,
      "target": "body.slug",
      "type": "string"
    },
    {
      "name": "bindSession",
      "required": false,
      "target": "body.bindSession",
      "type": "boolean"
    },
    {
      "name": "confirmedSetupHooks",
      "required": false,
      "target": "body.confirmedSetupHooks",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/worktrees"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
