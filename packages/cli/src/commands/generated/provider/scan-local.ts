import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "provider",
    "scan-local"
  ],
  "description": "Scan local agent configs",
  "flags": [],
  "method": "post",
  "path": "/external-provider-sources/local-scan"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
