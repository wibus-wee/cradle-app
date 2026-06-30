import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
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
    "health"
  ],
  "description": "Read remote host agentd daemon health",
  "flags": [],
  "method": "get",
  "path": "/remote-hosts/{hostId}/agentd/health"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
