import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "remote-host",
    "list"
  ],
  "description": "List remote Cradle Server hosts",
  "flags": [],
  "method": "get",
  "path": "/remote-hosts"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
