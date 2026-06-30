import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "routeSegment",
      "required": true,
      "target": "path.routeSegment",
      "type": "string"
    }
  ],
  "command": [
    "plugin",
    "set-enabled"
  ],
  "description": "Set plugin activation",
  "flags": [
    {
      "name": "enabled",
      "required": true,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "reason",
      "required": false,
      "target": "body.reason",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/plugins/{routeSegment}/enabled"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
