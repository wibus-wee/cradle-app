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
    "github-pull-request"
  ],
  "description": "Create or refresh a GitHub pull request diff review",
  "flags": [
    {
      "name": "owner",
      "required": true,
      "target": "body.owner",
      "type": "string"
    },
    {
      "name": "repo",
      "required": true,
      "target": "body.repo",
      "type": "string"
    },
    {
      "name": "number",
      "required": true,
      "target": "body.number",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/diff-reviews/github-pull-request"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
