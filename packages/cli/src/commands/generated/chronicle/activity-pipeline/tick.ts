import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "activity-pipeline",
    "tick"
  ],
  "description": "Run one Chronicle automatic activity pipeline tick",
  "flags": [],
  "method": "post",
  "path": "/chronicle/activity-pipeline/tick"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
