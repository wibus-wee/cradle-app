import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "codex",
    "config-schema"
  ],
  "description": "Read the bundled Codex provider configuration schema",
  "flags": [],
  "method": "get",
  "path": "/provider-targets/codex/config-schema"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
