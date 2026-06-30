import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "model-resources",
    "install-all"
  ],
  "description": "Install all Chronicle model resources from manifests",
  "flags": [],
  "method": "post",
  "path": "/chronicle/model-resources/install-all"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
