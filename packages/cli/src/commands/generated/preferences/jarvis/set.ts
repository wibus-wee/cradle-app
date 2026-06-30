import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "jarvis",
    "set"
  ],
  "description": "Set Jarvis preferences",
  "flags": [
    {
      "description": "Chat runtime ID used by Jarvis sessions",
      "name": "runtimeKind",
      "required": false,
      "target": "body.runtimeKind",
      "type": "string"
    },
    {
      "name": "profileId",
      "required": true,
      "target": "body.profileId",
      "type": "string"
    },
    {
      "description": "Explicit model ID for Jarvis (e.g. gpt-4o, claude-3-7-sonnet)",
      "name": "model",
      "required": false,
      "target": "body.model",
      "type": "string"
    },
    {
      "name": "thinkingLevel",
      "required": true,
      "target": "body.thinkingLevel",
      "type": "string",
      "values": [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ]
    }
  ],
  "method": "put",
  "path": "/preferences/jarvis"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
