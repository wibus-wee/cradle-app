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
    "launch-config"
  ],
  "description": "Update ACP agent launch config (local base or registry overrides)",
  "flags": [
    {
      "name": "name",
      "required": false,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "overrideCmd",
      "required": false,
      "target": "body.overrideCmd",
      "type": "string"
    },
    {
      "name": "overrideArgs",
      "required": false,
      "target": "body.overrideArgs",
      "type": "string[]"
    },
    {
      "name": "overrideEnv",
      "required": false,
      "target": "body.overrideEnv",
      "type": "json"
    },
    {
      "name": "cmd",
      "required": false,
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
  "method": "patch",
  "path": "/acp/agents/{agentId}/launch-config"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
