import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "config",
    "get"
  ],
  "description": "Get Chronicle daemon configuration",
  "flags": [],
  "method": "get",
  "path": "/chronicle/config"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
