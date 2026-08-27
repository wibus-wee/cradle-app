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
    "auth-clear"
  ],
  "description": "Clear an ACP agent authentication selection",
  "flags": [],
  "method": "delete",
  "path": "/acp/agents/{agentId}/auth"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
