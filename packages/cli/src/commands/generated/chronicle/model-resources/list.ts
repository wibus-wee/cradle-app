import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "model-resources",
    "list"
  ],
  "description": "Get Chronicle local model resource status",
  "flags": [],
  "method": "get",
  "path": "/chronicle/model-resources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
