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
    "cradle-server",
    "workspace",
    "list"
  ],
  "description": "List workspaces from a remote Cradle Server",
  "flags": [],
  "method": "get",
  "path": "/remote-hosts/{hostId}/cradle-server/workspaces"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
