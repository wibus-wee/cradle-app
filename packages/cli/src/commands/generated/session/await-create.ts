import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "await-create"
  ],
  "description": "Register a new session await",
  "flags": [
    {
      "name": "chatSessionId",
      "required": true,
      "target": "body.chatSessionId",
      "type": "string"
    },
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
      "name": "source",
      "required": true,
      "target": "body.source",
      "type": "string"
    },
    {
      "name": "filterJson",
      "required": true,
      "target": "body.filterJson",
      "type": "string"
    },
    {
      "name": "reason",
      "required": false,
      "target": "body.reason",
      "type": "string"
    },
    {
      "name": "expiresAt",
      "required": false,
      "target": "body.expiresAt",
      "type": "number"
    },
    {
      "name": "fireAt",
      "required": false,
      "target": "body.fireAt",
      "type": "number"
    }
  ],
  "method": "post",
  "path": "/session-awaits/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
