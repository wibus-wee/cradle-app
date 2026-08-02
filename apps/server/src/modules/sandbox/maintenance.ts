import type { MaintenanceResult } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'
import * as Sandbox from './service'

const DEFAULT_INTERVAL_MS = 60_000

export async function reconcileSandboxPoolTask(): Promise<MaintenanceResult> {
  const result = await Sandbox.reconcilePool()
  return {
    expiredReleased: result.expiredReleased,
    orphansRemoved: result.orphansRemoved,
    warmEnsured: result.warmEnsured,
  }
}

export function registerSandboxMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'sandbox',
    key: 'reconcile-pool',
    title: 'Reconcile sandbox pool',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    maxRunMs: 60_000,
    run: () => reconcileSandboxPoolTask(),
  })
}
