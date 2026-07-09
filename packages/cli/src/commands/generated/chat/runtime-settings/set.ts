import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sessionId",
      "required": true,
      "target": "path.sessionId",
      "type": "string"
    }
  ],
  "command": [
    "chat",
    "runtime-settings",
    "set"
  ],
  "description": "Update runtime settings for a chat session",
  "flags": [
    {
      "name": "permissionMode",
      "required": false,
      "target": "body.permissionMode",
      "type": "string",
      "values": [
        "default",
        "acceptEdits",
        "bypassPermissions",
        "plan"
      ]
    },
    {
      "name": "accessMode",
      "required": false,
      "target": "body.accessMode",
      "type": "string",
      "values": [
        "approval-required",
        "full-access"
      ]
    },
    {
      "name": "interactionMode",
      "required": false,
      "target": "body.interactionMode",
      "type": "string",
      "values": [
        "default",
        "plan"
      ]
    },
    {
      "name": "claudeAgent",
      "required": false,
      "target": "body.claudeAgent",
      "type": "json"
    }
  ],
  "method": "patch",
  "path": "/chat/sessions/{sessionId}/runtime-settings"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
