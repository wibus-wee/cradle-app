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
    "auth-methods"
  ],
  "description": "List ACP agent authentication methods",
  "flags": [],
  "method": "get",
  "path": "/acp/agents/{agentId}/auth-methods"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
