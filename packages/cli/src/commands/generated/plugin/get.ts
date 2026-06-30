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
    "get"
  ],
  "description": "Get plugin descriptor",
  "flags": [],
  "method": "get",
  "path": "/plugins/{routeSegment}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
