import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import type { AgentProfile } from '~/features/agent-runtime/types'

import type { ProviderDetailCompositionViewProps } from './provider-detail-composition-view'
import {
  ProviderDetailCompositionView,
} from './provider-detail-composition-view'
import { providerExtensionFixtures } from './provider-extensions/fixtures'

const profileFixture: AgentProfile = {
  id: 'provider-openai',
  name: 'OpenAI Codex',
  providerKind: 'openai-compatible',
  enabled: true,
  configJson: JSON.stringify({ authMode: 'chatgpt', api: 'openai-responses' }),
  credentialRef: 'credential-chatgpt',
  customModels: '[]',
  iconSlug: 'openai',
  providerId: 'openai',
  createdAt: 1_786_586_000_000,
  updatedAt: 1_786_586_000_000,
}

const modelsFixture = [
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    providerKind: 'openai-compatible' as const,
    capabilities: { contextWindow: 1_050_000, reasoning: true, toolCall: true },
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    providerKind: 'openai-compatible' as const,
    capabilities: { contextWindow: 400_000, reasoning: true, toolCall: true },
  },
  {
    id: 'gpt-5.2-codex',
    label: 'GPT-5.2 Codex',
    providerKind: 'openai-compatible' as const,
    capabilities: { contextWindow: 400_000, reasoning: true, toolCall: true },
  },
]

const meta = {
  title: 'Agent Management/ProviderDetailCompositionView',
  component: ProviderDetailCompositionView,
  decorators: [
    Story => (
      <div className="min-h-screen bg-muted/20 p-10 text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    profile: profileFixture,
    displayName: 'OpenAI Codex',
    baseUrl: '',
    apiProtocol: 'openai-responses',
    credential: {
      id: 'credential-chatgpt',
      kind: 'chatgpt-auth',
      label: 'Codex OAuth',
      maskedSecret: 'OAuth session',
      chatgpt: {
        chatgptAccountId: 'acct_cradle_demo',
        chatgptPlanType: 'plus',
        updatedAt: 1_786_586_000_000,
      },
    },
    extensions: [providerExtensionFixtures.enabled],
    models: modelsFixture,
    enabledModels: modelsFixture.map(model => model.id),
    onDisplayNameChange: fn(),
    onProfileEnabledChange: fn(),
    onProviderKindChange: fn(),
    onBaseUrlChange: fn(),
    onApiProtocolChange: fn(),
    onRelogin: fn(),
    onTestConnection: fn(),
    onDuplicate: fn(),
    onRemove: fn(),
    onExtensionEnabledChange: fn(),
    onEnabledModelsChange: fn(),
    onRefreshModels: fn(),
  },
} satisfies Meta<typeof ProviderDetailCompositionView>

export default meta
type Story = StoryObj<typeof meta>

function InteractiveProviderDetail(args: ProviderDetailCompositionViewProps) {
  const [profile, setProfile] = useState(args.profile)
  const [displayName, setDisplayName] = useState(args.displayName)
  const [providerKind, setProviderKind] = useState(args.profile.providerKind)
  const [extensions, setExtensions] = useState(args.extensions)
  const [enabledModels, setEnabledModels] = useState(args.enabledModels)

  return (
    <ProviderDetailCompositionView
      {...args}
      profile={{ ...profile, providerKind }}
      displayName={displayName}
      extensions={extensions}
      enabledModels={enabledModels}
      onDisplayNameChange={(value) => {
        setDisplayName(value)
        args.onDisplayNameChange(value)
      }}
      onProfileEnabledChange={(enabled) => {
        setProfile(current => ({ ...current, enabled }))
        args.onProfileEnabledChange(enabled)
      }}
      onProviderKindChange={(kind) => {
        setProviderKind(kind)
        args.onProviderKindChange(kind)
      }}
      onExtensionEnabledChange={(extension, enabled) => {
        setExtensions(current => current.map(item => item.extensionKey === extension.extensionKey
          ? {
              ...item,
              desiredEnabled: enabled,
              status: enabled ? 'enabled' : 'disabled',
              providerKinds: enabled ? item.addedProviderKinds : [],
            }
          : item))
        args.onExtensionEnabledChange(extension, enabled)
      }}
      onEnabledModelsChange={(modelIds) => {
        setEnabledModels(modelIds)
        args.onEnabledModelsChange(modelIds)
      }}
    />
  )
}

export const CodexOAuthWithCliProxyApi: Story = {
  render: args => <InteractiveProviderDetail {...args} />,
}

export const ExtensionDisabled: Story = {
  args: {
    extensions: [providerExtensionFixtures.disabled],
  },
  render: args => <InteractiveProviderDetail {...args} />,
}
