import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "message-sources",
    "list"
  ],
  "description": "List Chronicle message sources",
  "flags": [],
  "method": "get",
  "path": "/chronicle/message-sources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
