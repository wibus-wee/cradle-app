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
    "update"
  ],
  "description": "Update a relay server",
  "flags": [
    {
      "name": "displayName",
      "required": false,
      "target": "body.displayName",
      "type": "string"
    },
    {
      "name": "relayUrl",
      "required": false,
      "target": "body.relayUrl",
      "type": "string"
    },
    {
      "name": "enabled",
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "isDefault",
      "required": false,
      "target": "body.isDefault",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/relay-servers/{relayServerId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
