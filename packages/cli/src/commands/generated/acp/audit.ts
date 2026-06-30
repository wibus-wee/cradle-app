import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "acp",
    "audit"
  ],
  "description": "Get ACP audit log",
  "flags": [
    {
      "name": "agentId",
      "required": false,
      "target": "query.agentId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/acp/audit"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
