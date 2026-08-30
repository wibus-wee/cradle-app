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
    "runtime-turn-settings",
    "set"
  ],
  "description": "Update settings for the currently running provider turn",
  "flags": [
    {
      "name": "model",
      "required": false,
      "target": "body.model",
      "type": "string"
    },
    {
      "name": "effort",
      "required": false,
      "target": "body.effort",
      "type": "string",
      "values": [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra"
      ]
    },
    {
      "name": "summary",
      "required": false,
      "target": "body.summary",
      "type": "string",
      "values": [
        "auto",
        "concise",
        "detailed",
        "none"
      ]
    },
    {
      "name": "serviceTier",
      "required": false,
      "target": "body.serviceTier",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/chat/sessions/{sessionId}/runtime-turn-settings"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
