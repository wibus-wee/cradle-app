import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectedGithubAppConnection, disconnectedGithubAppConnection, disconnectedWithLocalCredentialGithubAppConnection, pendingGithubAppLogin } from './fixtures/github-app-connection'
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
  localCredentialActive: 'Acting on GitHub as @{{login}} via local credentials',
  localCredentialActiveAnonymous: 'Acting on GitHub via local credentials',
  localCredentialActiveBadge: 'Active',
  localCredentialUpgradeHint: 'Comments, reviews, and pull requests will appear on GitHub as plain actions from your account. Connect the Cradle App below to attribute them to Cradle instead.',
  installDescriptionUpgrade: 'Optional: install the Cradle App into the repositories you use, then connect your GitHub identity for Cradle-attributed actions.',
}

afterEach(cleanup)

function renderView(overrides: Partial<React.ComponentProps<typeof GithubAppConnectionView>> = {}) {
  const callbacks = { onInstall: vi.fn(), onConnect: vi.fn(), onContinueInBrowser: vi.fn(), onCancel: vi.fn(), onDisconnect: vi.fn() }
  render(<GithubAppConnectionView connection={disconnectedGithubAppConnection} pendingLogin={null} labels={labels} {...callbacks} {...overrides} />)
  return callbacks
}

describe('githubAppConnectionView', () => {
  it('explains installation and starts a connection', () => {
    const callbacks = renderView()
    expect(screen.getByText('Install Cradle in the repositories you use')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install Cradle App' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    expect(callbacks.onInstall).toHaveBeenCalledOnce()
    expect(callbacks.onConnect).toHaveBeenCalledOnce()
  })

  it('shows the pending code and routes its actions', () => {
    const callbacks = renderView({ pendingLogin: pendingGithubAppLogin })
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
    expect(screen.getByText(/Connection expires/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue in browser' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(callbacks.onContinueInBrowser).toHaveBeenCalledOnce()
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })

  it('shows the active local credential with an upgrade path when the App is not connected', () => {
    renderView({ connection: disconnectedWithLocalCredentialGithubAppConnection })
    expect(screen.getByText('Acting on GitHub as @octocat via local credentials')).toBeTruthy()
    expect(screen.getByText(/plain actions from your account/)).toBeTruthy()
    expect(screen.getByText(/Optional: install the Cradle App/)).toBeTruthy()
  })

  it('keeps the install copy mandatory when no local credential exists', () => {
    renderView()
    expect(screen.queryByText(/via local credentials/)).toBeNull()
    expect(screen.getByText('First install the Cradle App into the organization and repositories where you want Cradle to act. Then connect your GitHub identity below.')).toBeTruthy()
  })

  it('hides the local credential strip once the App is connected', () => {
    renderView({
      connection: {
        ...connectedGithubAppConnection,
        localCredential: { available: true, login: 'octocat', source: 'gh-cli' },
      },
    })
    expect(screen.queryByText(/via local credentials/)).toBeNull()
    expect(screen.getByText('Posting as @octocat via Cradle')).toBeTruthy()
  })

  it('describes the selected GitHub identity', () => {
    renderView({ connection: connectedGithubAppConnection })
    expect(screen.getByText('Posting as @octocat via Cradle')).toBeTruthy()
  })

  it('reconnects an expired identity and disconnects a selected identity', () => {
    const reconnect = renderView({
      connection: { ...connectedGithubAppConnection, state: 'expired', error: labels.expired },
    })
    expect(screen.getByText(labels.expired)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    expect(reconnect.onConnect).toHaveBeenCalledOnce()

    cleanup()
    const disconnect = renderView({ connection: connectedGithubAppConnection })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }))
    expect(disconnect.onDisconnect).toHaveBeenCalledOnce()
  })
})
