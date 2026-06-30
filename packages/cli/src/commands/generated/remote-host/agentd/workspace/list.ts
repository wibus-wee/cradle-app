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
    "workspace",
    "list"
  ],
  "description": "List legacy workspace suggestions from a remote host",
  "flags": [
    {
      "name": "root",
      "required": false,
      "target": "query.root",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/remote-hosts/{hostId}/agentd/workspaces"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
