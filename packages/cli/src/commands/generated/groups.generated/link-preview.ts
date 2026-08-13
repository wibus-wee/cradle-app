import type { Command } from 'commander'

import { register as registerLinkPreviewGet } from '../link-preview/get'

export function registerGeneratedCommands(program: Command): void {
  registerLinkPreviewGet(program)
}
