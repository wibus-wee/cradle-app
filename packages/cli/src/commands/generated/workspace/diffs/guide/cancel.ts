import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string",
      "envDefault": "CRADLE_WORKSPACE_ID"
    },
    {
      "name": "reviewId",
      "required": true,
      "target": "path.reviewId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "guide",
    "cancel"
  ],
  "description": "Cancel diff change walkthrough generation",
  "flags": [],
  "method": "post",
  "path": "/workspaces/{workspaceId}/diff-reviews/{reviewId}/guide/cancel"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
