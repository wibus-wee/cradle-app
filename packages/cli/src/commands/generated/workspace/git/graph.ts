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
    "graph"
  ],
  "description": "Get git graph",
  "flags": [
    {
      "name": "repo",
      "required": false,
      "target": "query.repo",
      "type": "string"
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/workspaces/{workspaceId}/git/graph"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
