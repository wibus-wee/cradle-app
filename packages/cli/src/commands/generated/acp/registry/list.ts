import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "acp",
    "registry",
    "list"
  ],
  "description": "List registry agents",
  "flags": [],
  "method": "get",
  "path": "/acp/registry"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
