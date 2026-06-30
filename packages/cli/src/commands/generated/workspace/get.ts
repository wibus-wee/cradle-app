import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "get"
  ],
  "description": "Get workspace",
  "flags": [],
  "method": "get",
  "path": "/workspaces/{workspaceId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
