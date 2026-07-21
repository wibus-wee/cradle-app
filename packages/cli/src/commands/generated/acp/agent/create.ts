import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "acp",
    "agent",
    "create"
  ],
  "description": "Register a local ACP agent",
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
      "name": "cmd",
      "required": true,
      "target": "body.cmd",
      "type": "string"
    },
    {
      "name": "args",
      "required": false,
      "target": "body.args",
      "type": "string[]"
    },
    {
      "name": "env",
      "required": false,
      "target": "body.env",
      "type": "json"
    },
    {
      "name": "distributionType",
      "required": false,
      "target": "body.distributionType",
      "type": "string",
      "values": [
        "command",
        "npx",
        "uvx"
      ]
    },
    {
      "name": "version",
      "required": false,
      "target": "body.version",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/acp/agents"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
