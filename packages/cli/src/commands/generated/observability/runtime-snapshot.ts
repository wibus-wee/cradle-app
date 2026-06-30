import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "observability",
    "runtime-snapshot"
  ],
  "description": "Get runtime observability snapshot",
  "flags": [],
  "method": "get",
  "path": "/observability/runtime-snapshot"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
