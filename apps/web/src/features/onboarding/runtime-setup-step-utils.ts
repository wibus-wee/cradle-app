import { projectResourceTransferProgress } from '~/features/managed-resources/projection'

import type { OnboardingRuntimeItem } from './runtime-setup-step-view'

/** True when every required runtime reports `installed`. */
export function areRequiredOnboardingRuntimesInstalled(
  items: readonly OnboardingRuntimeItem[],
): boolean {
  return items
    .filter(item => item.resource.required)
    .every(item => item.resource.state === 'installed')
}

/** True while any required runtime still has an in-flight transfer. */
export function hasActiveRequiredDownload(
  items: readonly OnboardingRuntimeItem[],
): boolean {
  return items
    .filter(item => item.resource.required)
    .some(item => projectResourceTransferProgress(item.tasks).activeTasks.length > 0)
}
