import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "pull-request",
    "refresh"
  ],
  "description": "Force-refresh the authenticated user's pull request feeds from GitHub",
  "flags": [
    {
      "name": "login",
      "required": true,
      "target": "body.login",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/pull-requests/refresh"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
