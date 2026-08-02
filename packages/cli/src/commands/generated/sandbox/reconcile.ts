import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "sandbox",
    "reconcile"
  ],
  "description": "Reconcile sandbox pool against the container engine",
  "flags": [],
  "method": "post",
  "path": "/sandboxes/reconcile"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
