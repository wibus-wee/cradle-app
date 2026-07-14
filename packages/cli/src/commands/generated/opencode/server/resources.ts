import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "opencode",
    "server",
    "resources"
  ],
  "description": "Get one active pooled opencode host process resource sample",
  "flags": [],
  "method": "get",
  "path": "/opencode/server/resources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
