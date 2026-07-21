import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "kimi",
    "server",
    "resources"
  ],
  "description": "Get the active kimi web host process resource sample",
  "flags": [],
  "method": "get",
  "path": "/kimi/server/resources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
