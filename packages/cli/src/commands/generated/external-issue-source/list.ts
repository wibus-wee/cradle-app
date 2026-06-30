import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "external-issue-source",
    "list"
  ],
  "description": "List external issue sources",
  "flags": [],
  "method": "get",
  "path": "/external-issue-sources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
