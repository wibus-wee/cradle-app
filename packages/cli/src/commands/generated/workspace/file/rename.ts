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
    "rename"
  ],
  "description": "Rename workspace file path",
  "flags": [
    {
      "name": "sourcePath",
      "required": true,
      "target": "body.sourcePath",
      "type": "string"
    },
    {
      "name": "destinationPath",
      "required": true,
      "target": "body.destinationPath",
      "type": "string"
    },
    {
      "name": "confirmedNonCradleOwnedWrite",
      "required": true,
      "target": "body.confirmedNonCradleOwnedWrite",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/workspaces/{workspaceId}/files/path"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
