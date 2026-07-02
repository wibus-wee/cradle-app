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
    "cradle-server",
    "disconnect"
  ],
  "description": "Disconnect from a remote Cradle Server",
  "flags": [],
  "method": "post",
  "path": "/remote-hosts/{hostId}/cradle-server/disconnect"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
