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
