import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chat",
    "handoff",
    "create"
  ],
  "description": "Hand off a chat thread to another provider target",
  "flags": [
    {
      "name": "requestId",
      "required": true,
      "target": "body.requestId",
      "type": "string"
    },
    {
      "name": "sourceSessionId",
      "required": true,
      "target": "body.sourceSessionId",
      "type": "string"
    },
    {
      "name": "destinationProviderTargetId",
      "required": true,
      "target": "body.destinationProviderTargetId",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "name": "thinkingEffort",
      "required": false,
      "target": "body.thinkingEffort",
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
    }
  ],
  "method": "post",
  "path": "/thread-handoffs"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
