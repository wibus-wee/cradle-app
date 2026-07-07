import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "patterns",
    "hourly"
  ],
  "description": "Get hourly usage pattern",
  "flags": [],
  "method": "get",
  "path": "/usage/patterns/hourly"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
