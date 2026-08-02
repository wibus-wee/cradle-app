import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "work",
    "sandbox-lease"
  ],
  "description": "Lease an OrbStack/Docker sandbox for a Work",
  "flags": [
    {
      "name": "profileId",
      "required": true,
      "target": "body.profileId",
      "type": "string"
    },
    {
      "name": "purpose",
      "required": false,
      "target": "body.purpose",
      "type": "string"
    },
    {
      "name": "mountWritable",
      "required": false,
      "target": "body.mountWritable",
      "type": "boolean"
    },
    {
      "name": "networkMode",
      "required": false,
      "target": "body.networkMode",
      "type": "string",
      "values": [
        "none",
        "bridge"
      ]
    },
    {
      "name": "ttlSec",
      "required": false,
      "target": "body.ttlSec",
      "type": "number"
    }
  ],
  "method": "post",
  "path": "/works/{id}/sandboxes/lease"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
