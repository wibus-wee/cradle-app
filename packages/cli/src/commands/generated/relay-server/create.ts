import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "relay-server",
    "create"
  ],
  "description": "Create a relay server",
  "flags": [
    {
      "name": "id",
      "required": false,
      "target": "body.id",
      "type": "string"
    },
    {
      "name": "displayName",
      "required": true,
      "target": "body.displayName",
      "type": "string"
    },
    {
      "name": "relayUrl",
      "required": true,
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
  "method": "post",
  "path": "/relay-servers"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
