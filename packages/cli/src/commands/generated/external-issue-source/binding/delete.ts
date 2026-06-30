import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "bindingId",
      "required": true,
      "target": "path.bindingId",
      "type": "string"
    }
  ],
  "command": [
    "external-issue-source",
    "binding",
    "delete"
  ],
  "description": "Delete an external issue source binding",
  "flags": [],
  "method": "delete",
  "path": "/external-issue-sources/bindings/{bindingId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
