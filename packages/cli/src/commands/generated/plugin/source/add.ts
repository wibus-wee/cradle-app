import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "plugin",
    "source",
    "add"
  ],
  "description": "Add plugin source",
  "flags": [
    {
      "name": "kind",
      "required": true,
      "target": "body.kind",
      "type": "string",
      "values": [
        "localPath",
        "git",
        "npm"
      ]
    },
    {
      "name": "location",
      "required": true,
      "target": "body.location",
      "type": "string"
    },
    {
      "name": "ref",
      "required": false,
      "target": "body.ref",
      "type": "string"
    },
    {
      "name": "subPath",
      "required": false,
      "target": "body.subPath",
      "type": "string"
    },
    {
      "name": "label",
      "required": false,
      "target": "body.label",
      "type": "string"
    },
    {
      "name": "addedReason",
      "required": false,
      "target": "body.addedReason",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/plugins/sources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
