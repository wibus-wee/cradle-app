import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "remote-host",
    "create"
  ],
  "description": "Create a remote Cradle Server host",
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
      "name": "enabled",
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "connectionConfig",
      "required": false,
      "target": "body.connectionConfig",
      "type": "json"
    },
    {
      "name": "capabilities",
      "required": false,
      "target": "body.capabilities",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/remote-hosts"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
