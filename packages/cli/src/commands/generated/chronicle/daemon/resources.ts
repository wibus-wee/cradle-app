import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "daemon",
    "resources"
  ],
  "description": "Get Chronicle daemon process resource usage",
  "flags": [],
  "method": "get",
  "path": "/chronicle/daemon/resources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
