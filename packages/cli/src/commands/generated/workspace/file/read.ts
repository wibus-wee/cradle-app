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
    "file",
    "read"
  ],
  "description": "Read workspace file content",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "query.path",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/workspaces/{workspaceId}/files/content"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
