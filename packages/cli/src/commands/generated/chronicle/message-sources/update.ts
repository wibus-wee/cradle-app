import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sourceId",
      "required": true,
      "target": "path.sourceId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "message-sources",
    "update"
  ],
  "description": "Update a Chronicle message source",
  "flags": [
    {
      "name": "label",
      "required": false,
      "target": "body.label",
      "type": "string"
    },
    {
      "name": "enabled",
      "required": false,
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
      "required": false,
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
  "method": "patch",
  "path": "/chronicle/message-sources/{sourceId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
