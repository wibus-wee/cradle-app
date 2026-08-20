import {
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  DeleteLine as TrashIcon,
  EnterDoorLine as LogInIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'

import { ProviderIconTile } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import type { AgentProfile, ApiProviderKind, ModelDescriptor } from '~/features/agent-runtime/types'

import { ChatgptCredentialSummary } from './chatgpt-credential-summary'
import type { ProviderExtensionViewModel } from './provider-extensions/provider-extensions-contract'
import { ProviderExtensionsView } from './provider-extensions/provider-extensions-view'
import { AuthModeSegmented, SetupField } from './provider-setup-form'
import type { CredentialMetadata } from './use-credential-metadata'

const PROVIDER_KIND_OPTIONS = [
  { value: 'openai-compatible', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'universal', label: 'Universal' },
] as const

export interface ProviderDetailCompositionViewProps {
  profile: AgentProfile
  displayName: string
  baseUrl: string
  apiProtocol: string
  credential: CredentialMetadata
  extensions: ProviderExtensionViewModel[]
  pendingExtensionKey?: string | null
  models: ModelDescriptor[]
  enabledModels: string[]
  onDisplayNameChange: (value: string) => void
  onProfileEnabledChange: (enabled: boolean) => void
  onProviderKindChange: (kind: ApiProviderKind) => void
  onBaseUrlChange: (value: string) => void
  onApiProtocolChange: (value: string) => void
  onRelogin: () => void
  onTestConnection: () => void
  onDuplicate: () => void
  onRemove: () => void
  onExtensionEnabledChange: (extension: ProviderExtensionViewModel, enabled: boolean) => void
  onEnabledModelsChange: (modelIds: string[]) => void
  onRefreshModels: () => void
}

export function ProviderDetailCompositionView({
  profile,
  displayName,
  baseUrl,
  apiProtocol,
  credential,
  extensions,
  pendingExtensionKey = null,
  models,
  enabledModels,
  onDisplayNameChange,
  onProfileEnabledChange,
  onProviderKindChange,
  onBaseUrlChange,
  onApiProtocolChange,
  onRelogin,
  onTestConnection,
  onDuplicate,
  onRemove,
  onExtensionEnabledChange,
  onEnabledModelsChange,
  onRefreshModels,
}: ProviderDetailCompositionViewProps) {
  const allModelsEnabled = enabledModels.length === models.length

  return (
    <div data-testid="provider-detail-composition-view" className="flex max-w-2xl flex-col gap-10">
      <header className="flex items-center gap-4">
        <ProviderIconTile iconSlug={profile.iconSlug} presetId={profile.providerId} size="lg" />

        <div className="min-w-0 flex-1">
          <h4 className="font-heading truncate text-[17px] font-medium tracking-[-0.01em] text-foreground">
            {displayName.trim() || profile.name}
          </h4>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground/70">
            Codex OAuth · OpenAI compatible
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-success">
            <CheckIcon className="size-3" />
            Saved
          </span>
          <div className="flex items-center gap-2 rounded-full bg-muted/50 px-2.5 py-1">
            <Switch
              size="sm"
              checked={profile.enabled}
              onCheckedChange={onProfileEnabledChange}
              aria-label="Enable provider"
            />
            <span className="text-[11px] font-medium text-muted-foreground">
              {profile.enabled ? 'Active' : 'Off'}
            </span>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="Duplicate provider">
            <CopyIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label="Remove provider"
            className="hover:text-destructive"
          >
            <TrashIcon />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-9">
          <section className="flex flex-col gap-4">
            <h5 className="px-0.5 text-[13px] font-medium text-foreground">General</h5>
            <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4">
              <SetupField label="Display name" hint="The name shown in the provider list.">
                <Input
                  value={displayName}
                  onChange={event => onDisplayNameChange(event.target.value)}
                  className="h-9 w-full text-[13px]"
                />
              </SetupField>

              <SetupField label="Provider type" hint="Runtime protocol family for this provider.">
                <AuthModeSegmented
                  testIdPrefix="provider-composition-kind"
                  options={PROVIDER_KIND_OPTIONS}
                  value={profile.providerKind}
                  onChange={value => onProviderKindChange(value as ApiProviderKind)}
                />
              </SetupField>

              <SetupField label="Endpoint" hint="Managed by Codex OAuth for this provider.">
                <Input
                  value={baseUrl}
                  onChange={event => onBaseUrlChange(event.target.value)}
                  disabled
                  placeholder="Managed automatically"
                  className="h-9 w-full font-mono text-[12.5px]"
                />
              </SetupField>

              <SetupField label="API protocol" hint="Communication protocol for this endpoint.">
                <Select value={apiProtocol} onValueChange={onApiProtocolChange} disabled>
                  <SelectTrigger className="h-9 w-full text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                    <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                  </SelectContent>
                </Select>
              </SetupField>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h5 className="px-0.5 text-[13px] font-medium text-foreground">Authentication</h5>
            <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-4">
                <AuthModeSegmented
                  testIdPrefix="provider-composition-auth"
                  options={[
                    { value: 'apiKey', label: 'API key' },
                    { value: 'chatgpt', label: 'ChatGPT' },
                  ]}
                  value="chatgpt"
                  onChange={() => undefined}
                />
                <p className="-mt-1 text-[11.5px] text-muted-foreground">
                  How this provider signs in to Codex.
                </p>
                <ChatgptCredentialSummary credential={credential} />
                <Button type="button" size="xs" variant="outline" className="self-start" onClick={onRelogin}>
                  <LogInIcon className="size-3" />
                  Re-login with ChatGPT
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[12.5px] font-medium text-foreground">Connection</span>
                  <p className="text-[11.5px] text-muted-foreground">
                    Probe the endpoint with the saved credentials.
                  </p>
                </div>
                <Button type="button" size="xs" variant="outline" onClick={onTestConnection}>
                  Test connection
                </Button>
              </div>
            </div>
          </section>

          <ProviderExtensionsView
            extensions={extensions}
            pendingExtensionKey={pendingExtensionKey}
            onEnabledChange={onExtensionEnabledChange}
          />
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12.5px] font-medium text-foreground">Models</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Choose which models appear in the composer.
              </p>
            </div>
            <Button type="button" size="xs" variant="ghost" className="gap-1 text-[11px] text-muted-foreground" onClick={onRefreshModels}>
              <RefreshIcon className="size-3" />
              Refresh
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
            <ul className="divide-y divide-foreground/4">
              {models.map(model => (
                <li key={model.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-foreground/2.5">
                    <Checkbox
                      checked={enabledModels.includes(model.id)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...enabledModels, model.id]
                          : enabledModels.filter(id => id !== model.id)
                        onEnabledModelsChange(next)
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {model.label || model.id}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground/70">
                        {model.id}
                      </span>
                    </span>
                    {model.capabilities.contextWindow && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {Math.round(model.capabilities.contextWindow / 1000)}
k ctx
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{allModelsEnabled ? `All ${models.length} models visible` : `${enabledModels.length} of ${models.length} models visible`}</span>
            <span>Cached just now</span>
          </div>
        </section>
      </div>
    </div>
  )
}
