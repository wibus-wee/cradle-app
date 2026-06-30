import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "search"
  ],
  "description": "Search issues",
  "flags": [
    {
      "name": "q",
      "required": true,
      "target": "query.q",
      "type": "string"
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/issues/search"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
