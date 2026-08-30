import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "agentId",
      "required": true,
      "target": "path.agentId",
      "type": "string"
    }
  ],
  "command": [
    "acp",
    "agent",
    "auth-set"
  ],
  "description": "Select and authenticate an ACP agent method",
  "flags": [
    {
      "name": "methodId",
      "required": true,
      "target": "body.methodId",
      "type": "string"
    }
  ],
  "method": "put",
  "path": "/acp/agents/{agentId}/auth"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
