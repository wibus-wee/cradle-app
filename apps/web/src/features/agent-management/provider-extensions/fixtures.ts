import type { ProviderExtensionViewModel } from './provider-extensions-contract'

const baseExtension: ProviderExtensionViewModel = {
  id: 'binding-cpa',
  providerTargetId: 'provider-openai',
  extensionOwner: '@cradleapp/cli-proxy-api',
  extensionId: 'cli-proxy-api',
  extensionKey: '@cradleapp/cli-proxy-api:cli-proxy-api',
  label: 'CLIProxyAPI',
  description: 'Adds runtime protocol compatibility.',
  applicable: true,
  unavailableReason: null,
  desiredEnabled: false,
  status: 'disabled',
  credentialStrategy: 'borrowed-static',
  credentialOwner: 'host',
  providerKinds: [],
  addedProviderKinds: ['anthropic'],
  lastError: null,
  updatedAt: 0,
}

export const providerExtensionFixtures = {
  disabled: baseExtension,
  enabling: { ...baseExtension, desiredEnabled: true, status: 'enabling' as const },
  enabled: {
    ...baseExtension,
    desiredEnabled: true,
    status: 'enabled' as const,
    providerKinds: ['anthropic' as const],
  },
  suspended: {
    ...baseExtension,
    desiredEnabled: true,
    status: 'suspended' as const,
  },
  error: {
    ...baseExtension,
    desiredEnabled: true,
    status: 'error' as const,
    lastError: 'Provider extension reconcile failed',
  },
  inapplicable: {
    ...baseExtension,
    applicable: false,
    unavailableReason: '此扩展需要 API key 或 Codex OAuth 凭据。',
  },
}
