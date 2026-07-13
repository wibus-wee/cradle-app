import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "pull-request",
    "viewer"
  ],
  "description": "Get the authenticated GitHub identity the pull request feeds are scoped to",
  "flags": [],
  "method": "get",
  "path": "/pull-requests/viewer"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
