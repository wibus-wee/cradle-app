import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sourceKey",
      "required": true,
      "target": "path.sourceKey",
      "type": "string"
    }
  ],
  "command": [
    "external-issue-source",
    "refresh-source"
  ],
  "description": "Refresh external issue source bindings for a workspace",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "force",
      "required": false,
      "target": "body.force",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/external-issue-sources/{sourceKey}/refresh"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
