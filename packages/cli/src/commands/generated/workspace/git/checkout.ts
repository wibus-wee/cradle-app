import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
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
    }
  ],
  "command": [
    "workspace",
    "git",
    "checkout"
  ],
  "description": "Checkout branch",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "body.repo",
      "type": "string"
    },
    {
      "name": "branch",
      "required": true,
      "target": "body.branch",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/git/checkout"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
