import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "sandbox",
    "lease"
  ],
  "description": "Lease a sandbox from the OrbStack/Docker pool",
  "flags": [
    {
      "name": "profileId",
      "required": true,
      "target": "body.profileId",
      "type": "string"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "workId",
      "required": false,
      "target": "body.workId",
      "type": "string"
    },
    {
      "name": "sessionId",
      "required": false,
      "target": "body.sessionId",
      "type": "string"
    },
    {
      "name": "purpose",
      "required": false,
      "target": "body.purpose",
      "type": "string"
    },
    {
      "name": "mountPath",
      "required": false,
      "target": "body.mountPath",
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
  "path": "/sandboxes/leases"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
