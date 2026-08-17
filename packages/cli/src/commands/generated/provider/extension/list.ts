import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "providerTargetId",
      "required": true,
      "target": "path.providerTargetId",
      "type": "string"
    }
  ],
  "command": [
    "provider",
    "extension",
    "list"
  ],
  "description": "List extensions for a Provider target",
  "flags": [],
  "method": "get",
  "path": "/provider-targets/{providerTargetId}/extensions/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
