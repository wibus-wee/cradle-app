export interface ProviderExtensionHost {
  findActiveRunId: (providerTargetId: string) => string | null
  releaseRuntimeSessions: (providerTargetId: string) => void
  validateRefreshableCredential: (credentialRef: string, value: string) => boolean
}

let host: ProviderExtensionHost | null = null

export function configureProviderExtensionHost(nextHost: ProviderExtensionHost): void {
  host = nextHost
}

export function getProviderExtensionHost(): ProviderExtensionHost {
  if (!host) {
    throw new Error('Provider extension Host is not configured')
  }
  return host
}
