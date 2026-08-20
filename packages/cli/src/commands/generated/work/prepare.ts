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
    "work",
    "prepare"
  ],
  "description": "Prepare a Work handoff without publishing it",
  "flags": [
    {
      "name": "title",
      "required": true,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "summary",
      "required": true,
      "target": "body.summary",
      "type": "string"
    },
    {
      "name": "testPlan",
      "required": true,
      "target": "body.testPlan",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/works/{id}/prepare"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
