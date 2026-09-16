import type {
  ManagedResourceAction,
  ManagedResourceAdapter,
  ManagedResourceProjection,
} from '../../managed-resources/service'
import type {
  CodexRuntimeInstallationService,
  CodexRuntimeStatus,
} from './runtime-installation'

export type CodexManagedResourceInstallation = Pick<
  CodexRuntimeInstallationService,
  'status' | 'install' | 'uninstall'
>

function enabled(): ManagedResourceAction {
  return { available: true, reasonCode: null }
}

function disabled(reasonCode: string): ManagedResourceAction {
  return { available: false, reasonCode }
}

function projectStatus(status: CodexRuntimeStatus): ManagedResourceProjection {
  const configured = status.source === 'configured'
  const managed = status.source === 'managed'
  const external = status.source === 'configured' || status.source === 'path' || status.source === 'cli'
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
            ? 'codex_runtime_override_active'
            : managed
              ? 'managed_resource_already_installed'
              : installing
                ? 'codex_runtime_install_in_progress'
                : 'codex_runtime_target_unsupported'),
      update: updateAvailable
        ? enabled()
        : disabled(installing ? 'codex_runtime_install_in_progress' : 'managed_resource_update_unavailable'),
      uninstall: uninstallAvailable
        ? enabled()
        : disabled(installing
            ? 'codex_runtime_install_in_progress'
            : status.managedInstalled ? 'codex_runtime_in_use' : 'managed_resource_not_installed'),
    },
  }
}

export function createCodexManagedResourceAdapter(
  installation: CodexManagedResourceInstallation,
): ManagedResourceAdapter {
  return {
    namespace: 'codex',
    declarations: () => [{
      key: { namespace: 'codex', resourceType: 'runtime', resourceId: 'app-server' },
      displayName: 'Codex app-server',
      description: 'Codex app-server and code-mode host runtime managed by Cradle.',
      kind: 'runtime',
      required: true,
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
