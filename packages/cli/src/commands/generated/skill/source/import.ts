import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "skill",
    "source",
    "import"
  ],
  "description": "Import skills from fetch",
  "flags": [
    {
      "name": "sessionId",
      "required": true,
      "target": "body.sessionId",
      "type": "string"
    },
    {
      "name": "selectedDirs",
      "required": true,
      "target": "body.selectedDirs",
      "type": "string[]"
    },
    {
      "name": "scope",
      "required": true,
      "target": "body.scope",
      "type": "string",
      "values": [
        "builtin",
        "legacy",
        "global",
        "repository",
        "workspace",
        "agent"
      ]
    },
    {
      "name": "overwrite",
      "required": false,
      "target": "body.overwrite",
      "type": "boolean"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/skills/import-from-fetch"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
