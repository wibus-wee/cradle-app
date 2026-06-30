import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "relayServerId",
      "required": true,
      "target": "path.relayServerId",
      "type": "string"
    }
  ],
  "command": [
    "relay-server",
    "delete"
  ],
  "description": "Delete a relay server",
  "flags": [],
  "method": "delete",
  "path": "/relay-servers/{relayServerId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
