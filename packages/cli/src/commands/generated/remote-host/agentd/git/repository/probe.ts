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
    "git",
    "repository",
    "probe"
  ],
  "description": "Probe whether a remote path belongs to a git repository",
  "flags": [
    {
      "name": "path",
      "required": true,
      "target": "query.path",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/remote-hosts/{hostId}/agentd/git/repository"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
