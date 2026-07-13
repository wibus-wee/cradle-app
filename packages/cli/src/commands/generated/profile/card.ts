import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "profile",
    "card"
  ],
  "description": "Get aggregated profile share-card stats",
  "flags": [],
  "method": "get",
  "path": "/usage/profile-card"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
