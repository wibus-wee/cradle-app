import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "workspace",
    "resolve"
  ],
  "description": "Resolve workspace by locator",
  "flags": [
    {
      "name": "hostId",
      "required": true,
      "target": "query.hostId",
      "type": "string"
    },
    {
      "name": "path",
      "required": true,
      "target": "query.path",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/workspaces/resolve"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
