import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "agentId",
      "required": true,
      "target": "path.agentId",
      "type": "string"
    }
  ],
  "command": [
    "acp",
    "agent",
    "remote-config"
  ],
  "description": "Update a remote ACP agent endpoint",
  "flags": [
    {
      "name": "name",
      "required": false,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "connectionType",
      "required": false,
      "target": "body.connectionType",
      "type": "string",
      "values": [
        "http",
        "websocket"
      ]
    },
    {
      "name": "endpointUrl",
      "required": false,
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
  "method": "patch",
  "path": "/acp/agents/{agentId}/remote-config"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
