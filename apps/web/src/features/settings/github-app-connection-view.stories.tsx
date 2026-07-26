import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { connectedGithubAppConnection, disconnectedGithubAppConnection, expiredGithubAppConnection, pendingGithubAppLogin, unconfiguredGithubAppConnection } from './fixtures/github-app-connection'
import { GithubAppConnectionView } from './github-app-connection-view'

const labels = {
  title: 'GitHub identity',
  description: 'Install the Cradle GitHub App, then connect your GitHub identity for user-attributed actions.',
  appBadge: 'GitHub App',
  installTitle: 'Install Cradle in the repositories you use',
  installDescription: 'First install the Cradle App into the organization and repositories where you want Cradle to act. Then connect your GitHub identity below.',
  install: 'Install Cradle App',
  connectTitle: 'Connect your GitHub identity',
  connectDescription: 'Enter this code in GitHub to authorize Cradle on your behalf.',
  connect: 'Connect GitHub',
  connecting: 'Loading GitHub connection…',
  continueInBrowser: 'Continue in browser',
  cancel: 'Cancel',
  disconnect: 'Disconnect',
  disconnectTitle: 'Disconnect GitHub?',
  disconnectDescription: 'This removes the local GitHub App credential from this device.',
  confirmDisconnect: 'Disconnect GitHub',
  connected: 'Posting as @{{login}} via Cradle',
  expires: 'Connection expires {{date}}',
  expired: 'Your GitHub connection has expired. Connect again to continue.',
  unavailable: 'GitHub App connection is unavailable in this build.',
  pendingCode: 'This code expires soon. Keep this window open while you finish in GitHub.',
}

const meta = {
  title: 'Settings/GithubAppConnectionView',
  component: GithubAppConnectionView,
  parameters: { layout: 'fullscreen' },
  args: {
    connection: disconnectedGithubAppConnection,
    pendingLogin: null,
    labels,
    onInstall: fn(),
    onConnect: fn(),
    onContinueInBrowser: fn(),
    onCancel: fn(),
    onDisconnect: fn(),
  },
} satisfies Meta<typeof GithubAppConnectionView>

export default meta
type Story = StoryObj<typeof meta>

export const Disconnected: Story = {}
export const Pending: Story = { args: { connection: { ...disconnectedGithubAppConnection, state: 'pending' }, pendingLogin: pendingGithubAppLogin } }
export const Connected: Story = { args: { connection: connectedGithubAppConnection } }
export const Expired: Story = { args: { connection: expiredGithubAppConnection } }
export const Unconfigured: Story = { args: { connection: unconfiguredGithubAppConnection } }
