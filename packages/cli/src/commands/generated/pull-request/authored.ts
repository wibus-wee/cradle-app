import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "pull-request",
    "authored"
  ],
  "description": "List pull requests authored by the given GitHub login, most recently updated first, paginated via `after`",
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
  "path": "/pull-requests/authored"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
