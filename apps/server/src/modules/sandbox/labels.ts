/** Docker/OrbStack labels owned by the Cradle sandbox module. */
export const SANDBOX_LABEL_MARK = 'cradle.sandbox'
export const SANDBOX_LABEL_PROFILE = 'cradle.sandbox.profile'
export const SANDBOX_LABEL_INSTANCE = 'cradle.sandbox.instance'
export const SANDBOX_LABEL_LEASE = 'cradle.sandbox.lease'
export const SANDBOX_LABEL_POOL_STATE = 'cradle.sandbox.pool_state'

export function sandboxLabels(input: {
  profileId: string
  instanceId: string
  poolState: string
  leaseId?: string | null
}): Record<string, string> {
  const labels: Record<string, string> = {
    [SANDBOX_LABEL_MARK]: '1',
    [SANDBOX_LABEL_PROFILE]: input.profileId,
    [SANDBOX_LABEL_INSTANCE]: input.instanceId,
    [SANDBOX_LABEL_POOL_STATE]: input.poolState,
  }
  if (input.leaseId) {
    labels[SANDBOX_LABEL_LEASE] = input.leaseId
  }
  return labels
}
