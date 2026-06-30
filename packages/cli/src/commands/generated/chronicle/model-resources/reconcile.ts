import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "model-resources",
    "reconcile"
  ],
  "description": "Reconcile Chronicle local model resources",
  "flags": [],
  "method": "post",
  "path": "/chronicle/model-resources/reconcile"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
