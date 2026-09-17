import type {
  ManagedResourceAction,
  ManagedResourceAdapter,
  ManagedResourceProjection,
} from '../managed-resources/service'
import type {
  OcrModelInstallationService,
  OcrModelRuntimeStatus,
} from './model-installation'

export type OcrModelManagedResourceInstallation = Pick<
  OcrModelInstallationService,
  'status' | 'install' | 'uninstall'
>

function enabled(): ManagedResourceAction {
  return { available: true, reasonCode: null }
}

function disabled(reasonCode: string): ManagedResourceAction {
  return { available: false, reasonCode }
}

function projectStatus(status: OcrModelRuntimeStatus): ManagedResourceProjection {
  const configured = status.source === 'configured'
  const managed = status.source === 'managed'
  const external = status.source === 'configured' || status.source === 'bundled'
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
            ? 'image_ocr_model_override_active'
            : managed
              ? 'managed_resource_already_installed'
              : installing
                ? 'image_ocr_model_install_in_progress'
                : 'image_ocr_model_target_unsupported'),
      update: updateAvailable
        ? enabled()
        : disabled(installing ? 'image_ocr_model_install_in_progress' : 'managed_resource_update_unavailable'),
      uninstall: uninstallAvailable
        ? enabled()
        : disabled(installing
            ? 'image_ocr_model_install_in_progress'
            : status.managedInstalled ? 'image_ocr_model_in_use' : 'managed_resource_not_installed'),
    },
  }
}

export function createOcrModelManagedResourceAdapter(
  installation: OcrModelManagedResourceInstallation,
): ManagedResourceAdapter {
  return {
    namespace: 'image-ocr',
    declarations: () => [{
      key: { namespace: 'image-ocr', resourceType: 'model', resourceId: 'ppocrv6-small' },
      displayName: 'Light OCR model',
      description: 'PP-OCRv6 Small model bundle managed by Cradle.',
      kind: 'model',
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
