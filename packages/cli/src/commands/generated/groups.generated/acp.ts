import type { Command } from 'commander'

import { register as registerAcpAgentAuthClear } from '../acp/agent/auth-clear'
import { register as registerAcpAgentAuthMethods } from '../acp/agent/auth-methods'
import { register as registerAcpAgentAuthSet } from '../acp/agent/auth-set'
import { register as registerAcpAgentCancelInstall } from '../acp/agent/cancel-install'
import { register as registerAcpAgentCreate } from '../acp/agent/create'
import { register as registerAcpAgentCreateRemote } from '../acp/agent/create-remote'
import { register as registerAcpAgentGet } from '../acp/agent/get'
import { register as registerAcpAgentInstall } from '../acp/agent/install'
import { register as registerAcpAgentInstallPath } from '../acp/agent/install-path'
import { register as registerAcpAgentLaunchConfig } from '../acp/agent/launch-config'
import { register as registerAcpAgentList } from '../acp/agent/list'
import { register as registerAcpAgentRemoteConfig } from '../acp/agent/remote-config'
import { register as registerAcpAgentUninstall } from '../acp/agent/uninstall'
import { register as registerAcpAudit } from '../acp/audit'
import { register as registerAcpRegistryDistributionTypes } from '../acp/registry/distribution-types'
import { register as registerAcpRegistryList } from '../acp/registry/list'

export function registerGeneratedCommands(program: Command): void {
  registerAcpAgentAuthClear(program)
  registerAcpAgentAuthMethods(program)
  registerAcpAgentAuthSet(program)
  registerAcpAgentCancelInstall(program)
  registerAcpAgentCreate(program)
  registerAcpAgentCreateRemote(program)
  registerAcpAgentGet(program)
  registerAcpAgentInstall(program)
  registerAcpAgentInstallPath(program)
  registerAcpAgentLaunchConfig(program)
  registerAcpAgentList(program)
  registerAcpAgentRemoteConfig(program)
  registerAcpAgentUninstall(program)
  registerAcpAudit(program)
  registerAcpRegistryDistributionTypes(program)
  registerAcpRegistryList(program)
}
