import type { Command } from 'commander'

import { register as registerDownloadCenterCancel } from '../download-center/cancel'
import { register as registerDownloadCenterGet } from '../download-center/get'
import { register as registerDownloadCenterList } from '../download-center/list'

export function registerGeneratedCommands(program: Command): void {
  registerDownloadCenterCancel(program)
  registerDownloadCenterGet(program)
  registerDownloadCenterList(program)
}
