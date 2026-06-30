import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "chat",
    "set"
  ],
  "description": "Set chat preferences",
  "flags": [
    {
      "name": "modelId",
      "required": true,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "name": "configSelections",
      "required": true,
      "target": "body.configSelections",
      "type": "json"
    },
    {
      "name": "continuationBehavior",
      "required": false,
      "target": "body.continuationBehavior",
      "type": "string",
      "values": [
        "queue",
        "steer"
      ]
    },
    {
      "name": "titleGeneration",
      "required": false,
      "target": "body.titleGeneration",
      "type": "json"
    }
  ],
  "method": "put",
  "path": "/preferences/chat"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
