import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { AcpAuthMethod, AcpAuthViewLabels } from './acp-auth-view'
import { AcpAuthView } from './acp-auth-view'

const methods: AcpAuthMethod[] = [
  {
    id: 'browser-login',
    name: 'Sign in with browser',
    description: 'Continue in the sign-in window opened by the agent.',
    kind: 'agent',
    status: 'supported',
  },
  {
    id: 'api-key',
    name: 'API key',
    description: 'Use credentials already stored in Cradle Secrets.',
    kind: 'env_var',
    status: 'supported',
    fields: [
      { name: 'API_KEY', label: 'API key', secret: true, optional: false },
      { name: 'API_HOST', label: 'API host', secret: false, optional: true },
    ],
  },
  {
    id: 'terminal-login',
    name: 'Terminal login',
    kind: 'terminal',
    status: 'unsupported',
    unavailableReason: 'Interactive terminal authentication is not available.',
  },
]

const labels: AcpAuthViewLabels = {
  title: 'Authentication',
  loading: 'Loading authentication methods',
  loadErrorTitle: 'Could not load authentication methods',
  loadErrorDescription: 'The agent did not complete authentication discovery.',
  retry: 'Retry',
  noMethods: 'This agent does not advertise authentication methods.',
  configuredPrefix: 'Configured with ',
  configuredUnavailable: 'The configured method is no longer available',
  change: 'Change',
  clear: 'Clear',
  clearing: 'Clearing…',
  methodLabel: 'Method',
  agentKind: 'Agent sign-in',
  envVarKind: 'Secrets',
  terminalKind: 'Terminal',
  unsupported: 'Unsupported',
  optional: 'Optional',
  secretPlaceholder: 'Select a Secret',
  secretNotSet: 'Not set',
  noSecrets: 'No Secrets are available.',
  secretLoadError: 'Could not load Secrets.',
  cancel: 'Cancel',
  save: 'Save',
  authenticate: 'Authenticate',
  saving: 'Saving…',
}

const meta = {
  title: 'Agent Runtimes/AcpAuthView',
  component: AcpAuthView,
  decorators: [Story => <div className="w-[34rem] bg-background p-6"><Story /></div>],
  parameters: { layout: 'centered' },
  args: {
    methods,
    selectedMethodId: null,
    secrets: [
      { id: 'secret-primary', label: 'Production API key', maskedSecret: '********4f2a' },
      { id: 'secret-staging', label: 'Staging API key', maskedSecret: '********91bc' },
    ],
    isLoading: false,
    isSecretsLoading: false,
    loadError: false,
    secretsError: false,
    pendingAction: null,
    labels,
    onRetry: fn(),
    onRetrySecrets: fn(),
    onSave: fn(),
    onClear: fn(),
    onOpenLink: fn(),
  },
} satisfies Meta<typeof AcpAuthView>

export default meta

type Story = StoryObj<typeof meta>

export const Configure: Story = {}

export const Configured: Story = {
  args: { selectedMethodId: 'api-key' },
}

export const Loading: Story = {
  args: { isLoading: true, methods: [] },
}

export const LoadError: Story = {
  args: { loadError: true, methods: [] },
}
