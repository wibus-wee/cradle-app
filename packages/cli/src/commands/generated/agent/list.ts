import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "agent",
    "list"
  ],
  "description": "List agents",
  "flags": [
    {
      "name": "enabled",
      "required": false,
      "target": "query.enabled",
      "type": "string"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "query.providerTargetId",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/agents/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
