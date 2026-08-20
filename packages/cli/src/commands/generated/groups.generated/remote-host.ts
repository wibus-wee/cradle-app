import type { Command } from 'commander'

import { register as registerRemoteHostCradleServerConnect } from '../remote-host/cradle-server/connect'
import { register as registerRemoteHostCradleServerDisconnect } from '../remote-host/cradle-server/disconnect'
import { register as registerRemoteHostCradleServerHealth } from '../remote-host/cradle-server/health'
import { register as registerRemoteHostCreate } from '../remote-host/create'
import { register as registerRemoteHostDelete } from '../remote-host/delete'
import { register as registerRemoteHostList } from '../remote-host/list'
import { register as registerRemoteHostRelayClaim } from '../remote-host/relay/claim'
import { register as registerRemoteHostUpdate } from '../remote-host/update'

export function registerGeneratedCommands(program: Command): void {
  registerRemoteHostCradleServerConnect(program)
  registerRemoteHostCradleServerDisconnect(program)
  registerRemoteHostCradleServerHealth(program)
  registerRemoteHostCreate(program)
  registerRemoteHostDelete(program)
  registerRemoteHostList(program)
  registerRemoteHostRelayClaim(program)
  registerRemoteHostUpdate(program)
}
