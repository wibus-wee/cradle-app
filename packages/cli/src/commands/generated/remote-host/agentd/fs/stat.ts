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
    "fs",
    "stat"
  ],
  "description": "Stat a path on a connected remote host",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "query.path",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/remote-hosts/{hostId}/agentd/fs/stat"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
