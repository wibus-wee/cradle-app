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
    "diff"
  ],
  "description": "Get git diff",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "query.repo",
      "type": "string"
    },
    {
      "name": "paths",
      "required": false,
      "target": "query.paths",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/workspaces/{workspaceId}/git/diff"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
