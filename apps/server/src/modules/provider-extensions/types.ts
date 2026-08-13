import type {
  ProviderExtensionCredentialStrategy,
  ProviderExtensionProviderKind,
} from '@cradle/plugin-sdk/server'

export type ProviderExtensionStatus
  = | 'disabled'
    | 'enabling'
    | 'enabled'
    | 'disabling'
    | 'suspended'
    | 'error'

export interface ProviderExtensionBindingView {
  id: string
  providerTargetId: string
  extensionOwner: string
  extensionId: string
  extensionKey: string
  label: string
  description: string | null
  applicable: boolean
  unavailableReason: string | null
  desiredEnabled: boolean
  status: ProviderExtensionStatus
  credentialStrategy: ProviderExtensionCredentialStrategy | null
  credentialOwner: 'host' | 'extension'
  providerKinds: ProviderExtensionProviderKind[]
  addedProviderKinds: ProviderExtensionProviderKind[]
  lastError: string | null
  updatedAt: number
}

export type ProviderExtensionLifecycleEventType
  = | 'enabling'
    | 'enabled'
    | 'disabling'
    | 'disabled'
    | 'suspended'
    | 'failed'
    | 'reconciled'

export interface ProviderExtensionLifecycleEvent {
  type: ProviderExtensionLifecycleEventType
  bindingId: string
  providerTargetId: string
  extensionOwner: string
  extensionId: string
  previousStatus: ProviderExtensionStatus
  status: ProviderExtensionStatus
  reason?: string
  errorCode?: string
}

export interface ProviderExtensionRuntimeRoute {
  bindingId: string
  extensionOwner: string
  extensionId: string
  providerKind: ProviderExtensionProviderKind
  configJson: string
  credentialRef: string | null
  effectiveModelId: string | null
}
