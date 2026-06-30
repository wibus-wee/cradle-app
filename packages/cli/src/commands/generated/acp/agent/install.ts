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
    "install"
  ],
  "description": "Install an agent",
  "flags": [
    {
      "name": "distributionType",
      "required": true,
      "target": "body.distributionType",
      "type": "string",
      "values": [
        "binary",
        "npx",
        "uvx"
      ]
    }
  ],
  "method": "put",
  "path": "/acp/agents/{agentId}/installation"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
