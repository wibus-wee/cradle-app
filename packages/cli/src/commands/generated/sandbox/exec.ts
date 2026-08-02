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
    "exec"
  ],
  "description": "Execute a command inside a leased sandbox",
  "flags": [
    {
      "name": "command",
      "required": true,
      "target": "body.command",
      "type": "string[]"
    },
    {
      "name": "workdir",
      "required": false,
      "target": "body.workdir",
      "type": "string"
    },
    {
      "name": "env",
      "required": false,
      "target": "body.env",
      "type": "json"
    },
    {
      "name": "timeoutMs",
      "required": false,
      "target": "body.timeoutMs",
      "type": "number"
    }
  ],
  "method": "post",
  "path": "/sandboxes/leases/{leaseId}/exec"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
