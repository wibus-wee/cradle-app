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
    "file",
    "write"
  ],
  "description": "Write workspace file content",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "body.path",
      "type": "string"
    },
    {
      "name": "content",
      "required": true,
      "target": "body.content",
      "type": "string"
    },
    {
      "name": "confirmedNonCradleOwnedWrite",
      "required": true,
      "target": "body.confirmedNonCradleOwnedWrite",
      "type": "boolean"
    }
  ],
  "method": "put",
  "path": "/workspaces/{workspaceId}/files/content"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
