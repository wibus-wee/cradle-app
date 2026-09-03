import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Accepts a workspace name or id.",
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": false
    }
  ],
  "command": [
    "workspace",
    "relink"
  ],
  "description": "Relink workspace location",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/workspaces/{workspaceId}/location"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
