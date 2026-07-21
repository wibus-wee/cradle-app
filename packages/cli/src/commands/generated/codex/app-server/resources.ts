import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "codex",
    "app-server",
    "resources"
  ],
  "description": "Get the active codex app-server process resource sample",
  "flags": [],
  "method": "get",
  "path": "/codex/app-server/resources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
