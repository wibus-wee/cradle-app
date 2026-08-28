import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "acp",
    "agent",
    "create-remote"
  ],
  "description": "Register a remote ACP agent endpoint",
  "flags": [
    {
      "name": "id",
      "required": false,
      "target": "body.id",
      "type": "string"
    },
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "connectionType",
      "required": true,
      "target": "body.connectionType",
      "type": "string",
      "values": [
        "http",
        "websocket"
      ]
    },
    {
      "name": "endpointUrl",
      "required": true,
      "target": "body.endpointUrl",
      "type": "string"
    },
    {
      "name": "headerSecretRefs",
      "required": false,
      "target": "body.headerSecretRefs",
      "type": "json"
    },
    {
      "name": "version",
      "required": false,
      "target": "body.version",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/acp/agents/remote"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
