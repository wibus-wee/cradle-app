import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "pull-request",
    "reviewing"
  ],
  "description": "List pull requests where the given GitHub login is a requested reviewer, most recently updated first, paginated via `after`",
  "flags": [
    {
      "name": "login",
      "required": true,
      "target": "query.login",
      "type": "string"
    },
    {
      "name": "after",
      "required": false,
      "target": "query.after",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/pull-requests/reviewing"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
