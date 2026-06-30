import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "link-preview",
    "get"
  ],
  "description": "Get link preview",
  "flags": [
    {
      "description": "Absolute http(s) URL to unfurl into a link card",
      "name": "url",
      "required": true,
      "target": "query.url",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/link-preview/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
