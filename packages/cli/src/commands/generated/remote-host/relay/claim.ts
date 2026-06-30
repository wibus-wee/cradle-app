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
    "relay",
    "claim"
  ],
  "description": "Claim a relay pairing code for a remote host",
  "flags": [
    {
      "name": "relayUrl",
      "required": false,
      "target": "body.relayUrl",
      "type": "string"
    },
    {
      "name": "relayServerId",
      "required": false,
      "target": "body.relayServerId",
      "type": "string"
    },
    {
      "name": "pairingCode",
      "required": true,
      "target": "body.pairingCode",
      "type": "string"
    },
    {
      "name": "ttlMs",
      "required": false,
      "target": "body.ttlMs",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/remote-hosts/{hostId}/relay/claim"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
