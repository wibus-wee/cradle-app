import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "delete"
  ],
  "description": "Delete workspace",
  "flags": [],
  "method": "delete",
  "path": "/workspaces/{workspaceId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
