import type { Command } from 'commander'

import { register as registerManagedResourcesGet } from '../managed-resources/get'
import { register as registerManagedResourcesInstall } from '../managed-resources/install'
import { register as registerManagedResourcesList } from '../managed-resources/list'
import { register as registerManagedResourcesUninstall } from '../managed-resources/uninstall'
import { register as registerManagedResourcesUpdate } from '../managed-resources/update'

export function registerGeneratedCommands(program: Command): void {
  registerManagedResourcesGet(program)
  registerManagedResourcesInstall(program)
  registerManagedResourcesList(program)
  registerManagedResourcesUninstall(program)
  registerManagedResourcesUpdate(program)
}
