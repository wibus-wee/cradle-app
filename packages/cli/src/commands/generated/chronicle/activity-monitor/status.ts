import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "activity-monitor",
    "status"
  ],
  "description": "Get Chronicle activity monitor status",
  "flags": [],
  "method": "get",
  "path": "/chronicle/activity-monitor/status"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
