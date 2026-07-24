import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "mcp-server",
    "set-enabled"
  ],
  "description": "Enable or disable a custom MCP server",
  "flags": [
    {
      "name": "enabled",
      "required": true,
      "target": "body.enabled",
      "type": "boolean"
    }
  ],
  "method": "patch",
  "path": "/mcp-servers/{id}/enabled"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
