import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "activity-storage",
    "stats"
  ],
  "description": "Get Chronicle activity storage stats",
  "flags": [],
  "method": "get",
  "path": "/chronicle/activity-storage/stats"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
