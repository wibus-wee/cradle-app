import type {
  ManagedResourceAction,
  ManagedResourceAdapter,
  ManagedResourceProjection,
} from '../../managed-resources/service'
import type {
  ClaudeCodeRuntimeInstallationService,
  ClaudeCodeRuntimeStatus,
} from './runtime-installation'

export type ClaudeManagedResourceInstallation = Pick<
  ClaudeCodeRuntimeInstallationService,
  'status' | 'install' | 'uninstall'
>

function enabled(): ManagedResourceAction {
  return { available: true, reasonCode: null }
}

function disabled(reasonCode: string): ManagedResourceAction {
  return { available: false, reasonCode }
}

function projectStatus(status: ClaudeCodeRuntimeStatus): ManagedResourceProjection {
  const configured = status.source === 'configured'
  const managed = status.source === 'managed'
  const external = status.source === 'configured' || status.source === 'sdk-bundled' || status.source === 'path'
  const installing = status.state === 'installing'
  const unavailable = status.state === 'unavailable'
  const installAvailable = !configured
    && !managed
    && !installing
    && !unavailable
  const updateAvailable = status.state === 'update-available' && managed
  const uninstallAvailable = status.managedInstalled && !installing

  return {
    state: status.state === 'ready'
      ? 'installed'
      : status.state === 'missing'
        ? 'not-installed'
        : status.state,
    installationSource: managed ? 'managed' : external ? 'external' : null,
    installedVersion: status.version,
    availableVersion: status.targetVersion,
    installedSizeBytes: status.installedSizeBytes,
    downloadSizeBytes: status.downloadSizeBytes,
    actions: {
      install: installAvailable
        ? enabled()
        : disabled(configured
            ? 'claude_agent_runtime_override_active'
            : managed
              ? 'managed_resource_already_installed'
              : installing
                ? 'claude_agent_runtime_install_in_progress'
                : 'claude_agent_runtime_target_unsupported'),
      update: updateAvailable
        ? enabled()
        : disabled(installing ? 'claude_agent_runtime_install_in_progress' : 'managed_resource_update_unavailable'),
      uninstall: uninstallAvailable
        ? enabled()
        : disabled(installing
            ? 'claude_agent_runtime_install_in_progress'
            : status.managedInstalled ? 'claude_agent_runtime_in_use' : 'managed_resource_not_installed'),
    },
  }
}

export function createClaudeManagedResourceAdapter(
  installation: ClaudeManagedResourceInstallation,
): ManagedResourceAdapter {
  return {
    namespace: 'claude-agent',
    declarations: () => [{
      key: { namespace: 'claude-agent', resourceType: 'runtime', resourceId: 'cli' },
      displayName: 'Claude Code runtime',
      description: 'Claude Code runtime managed by Cradle.',
      kind: 'runtime',
      required: false,
    }],
    async project() {
      return projectStatus(await installation.status())
    },
    async execute(_key, action) {
      if (action === 'uninstall') {
        return projectStatus(await installation.uninstall())
      }
      return projectStatus(await installation.install())
    },
  }
}
