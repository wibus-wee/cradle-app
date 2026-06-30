import { registerOperationCommand } from '../../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../../runtime/types'
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
    "fs",
    "directory",
    "list"
  ],
  "description": "List a directory on a connected remote host",
  "flags": [
    {
      "name": "path",
      "required": false,
      "target": "query.path",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/remote-hosts/{hostId}/agentd/fs/directory"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
