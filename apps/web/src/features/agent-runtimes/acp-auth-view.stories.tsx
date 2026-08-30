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
  terminalKind: 'Terminal',
  unsupported: 'Unsupported',
  cancel: 'Cancel',
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
    isLoading: false,
    loadError: false,
    pendingAction: null,
    labels,
    onRetry: fn(),
    onSave: fn(),
    onClear: fn(),
    onOpenLink: fn(),
  },
} satisfies Meta<typeof AcpAuthView>

export default meta

type Story = StoryObj<typeof meta>

export const Configure: Story = {}

export const Configured: Story = {
  args: { selectedMethodId: 'browser-login' },
}

export const Loading: Story = {
  args: { isLoading: true, methods: [] },
}

export const LoadError: Story = {
  args: { loadError: true, methods: [] },
}
