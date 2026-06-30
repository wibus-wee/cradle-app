import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "hostId",
      "required": true,
      "target": "path.hostId",
      "type": "string"
    }
  ],
  "command": [
    "remote-host",
    "agentd",
    "agent",
    "start"
  ],
  "description": "Start a mock remote agent on a remote host",
  "flags": [
    {
      "name": "runtimeKind",
      "required": true,
      "target": "body.runtimeKind",
      "type": "string"
    },
    {
      "name": "workspacePath",
      "required": true,
      "target": "body.workspacePath",
      "type": "string"
    },
    {
      "name": "chatSessionId",
      "required": false,
      "target": "body.chatSessionId",
      "type": "string"
    },
    {
      "name": "providerSessionId",
      "required": false,
      "target": "body.providerSessionId",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/remote-hosts/{hostId}/agentd/agents"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
