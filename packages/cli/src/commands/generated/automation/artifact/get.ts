import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    },
    {
      "name": "artifactId",
      "required": true,
      "target": "path.artifactId",
      "type": "string"
    }
  ],
  "command": [
    "automation",
    "artifact",
    "get"
  ],
  "description": "Get automation artifact",
  "flags": [],
  "method": "get",
  "path": "/automations/{id}/artifacts/{artifactId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
