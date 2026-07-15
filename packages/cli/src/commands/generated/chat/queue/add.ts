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
    "queue",
    "add"
  ],
  "description": "Enqueue a chat continuation for the session",
  "flags": [
    {
      "name": "text",
      "required": false,
      "target": "body.text",
      "type": "string"
    },
    {
      "name": "files",
      "required": false,
      "target": "body.files",
      "type": "json"
    },
    {
      "name": "contextParts",
      "required": false,
      "target": "body.contextParts",
      "type": "json"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
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
    },
    {
      "name": "runtimeSettings",
      "required": false,
      "target": "body.runtimeSettings",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/chat/sessions/{sessionId}/queue"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
