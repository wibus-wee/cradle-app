import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
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
    "update"
  ],
  "description": "Update a remote Cradle Server host",
  "flags": [
    {
      "name": "displayName",
      "required": false,
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
  "method": "patch",
  "path": "/remote-hosts/{hostId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
