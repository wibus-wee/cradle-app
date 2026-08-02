import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "leaseId",
      "required": true,
      "target": "path.leaseId",
      "type": "string"
    }
  ],
  "command": [
    "sandbox",
    "release"
  ],
  "description": "Release a sandbox lease",
  "flags": [],
  "method": "post",
  "path": "/sandboxes/leases/{leaseId}/release"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
