import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "message-sources",
    "create"
  ],
  "description": "Create a Chronicle message source",
  "flags": [
    {
      "name": "platform",
      "required": true,
      "target": "body.platform",
      "type": "string",
      "values": [
        "slack"
      ]
    },
    {
      "name": "label",
      "required": true,
      "target": "body.label",
      "type": "string"
    },
    {
      "name": "enabled",
      "required": true,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "teamId",
      "required": false,
      "target": "body.teamId",
      "type": "string"
    },
    {
      "name": "botTokenRef",
      "required": false,
      "target": "body.botTokenRef",
      "type": "string"
    },
    {
      "name": "channelIds",
      "required": true,
      "target": "body.channelIds",
      "type": "string[]"
    },
    {
      "name": "realtimeMode",
      "required": false,
      "target": "body.realtimeMode",
      "type": "string",
      "values": [
        "polling",
        "events-api"
      ]
    },
    {
      "name": "signingSecretRef",
      "required": false,
      "target": "body.signingSecretRef",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/chronicle/message-sources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
