import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
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
      "name": "reviewId",
      "required": true,
      "target": "path.reviewId",
      "type": "string"
    },
    {
      "name": "commitPlanId",
      "required": true,
      "target": "path.commitPlanId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "commit-plan",
    "apply"
  ],
  "description": "Apply diff review commit plan",
  "flags": [
    {
      "name": "idempotencyKey",
      "required": false,
      "target": "body.idempotencyKey",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/diff-reviews/{reviewId}/commit-plans/{commitPlanId}/apply"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
