import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "category",
      "required": true,
      "target": "path.category",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "model-resources",
    "install"
  ],
  "description": "Install a Chronicle local model resource",
  "flags": [
    {
      "name": "source",
      "required": false,
      "target": "body.source",
      "type": "string",
      "values": [
        "manifest",
        "local-files"
      ]
    },
    {
      "name": "sourceRoot",
      "required": false,
      "target": "body.sourceRoot",
      "type": "string"
    },
    {
      "name": "files",
      "required": false,
      "target": "body.files",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/chronicle/model-resources/{category}/install"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
