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
    "update"
  ],
  "description": "Update workspace",
  "flags": [
    {
      "name": "name",
      "required": false,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "pinned",
      "required": false,
      "target": "body.pinned",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/workspaces/{workspaceId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
