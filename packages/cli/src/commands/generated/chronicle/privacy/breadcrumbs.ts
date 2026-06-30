import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "privacy",
    "breadcrumbs"
  ],
  "description": "List Chronicle privacy breadcrumbs",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/chronicle/privacy/breadcrumbs"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
