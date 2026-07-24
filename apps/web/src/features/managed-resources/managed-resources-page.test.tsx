// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ManagedResourcesPage } from './managed-resources-page'
import type { ManagedResource } from './projection'

const { action, resourceState } = vi.hoisted(() => ({
  action: {
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  },
  resourceState: { resources: [] as ManagedResource[] },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => values?.name ? `${key}:${values.name}` : key,
  }),
}))
vi.mock('./use-managed-resources', () => ({
  useManagedResources: () => ({
    resources: resourceState.resources,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useManagedResourceAction: () => action,
}))
vi.mock('~/features/download-center/use-download-center', () => ({
  useDownloadCenter: () => ({ tasks: [], active: [], recent: [] }),
  useDownloadCenterOwner: () => [],
  useDownloadCenterCancel: () => vi.fn(),
}))

function resource(overrides: Partial<ManagedResource> = {}): ManagedResource {
  return {
    key: { namespace: 'opencode', resourceType: 'runtime', resourceId: 'cli' },
    displayName: 'OpenCode CLI',
    description: 'Optional OpenCode runtime',
    kind: 'runtime',
    required: false,
    state: 'not-installed',
    installationSource: null,
    installedVersion: null,
    availableVersion: '1.17.11',
    installedSizeBytes: null,
    downloadSizeBytes: 42,
    actions: {
      install: { available: true, reasonCode: null },
      update: { available: false, reasonCode: 'managed_resource_update_unavailable' },
      uninstall: { available: false, reasonCode: 'managed_resource_not_installed' },
    },
    ...overrides,
  }
}

function renderPage(children: ReactNode = <ManagedResourcesPage />) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>,
  )
}

describe('managedResourcesPage', () => {
  beforeEach(() => {
    action.isPending = false
    action.isError = false
    action.mutate.mockReset()
    resourceState.resources = [resource()]
  })

  afterEach(() => {
    cleanup()
  })
  it('shows an optional OpenCode declaration before transfer and dispatches generic install', () => {
    renderPage()
    expect(screen.getByText('OpenCode CLI')).toBeTruthy()
    expect(screen.getByText('1.17.11')).toBeTruthy()
    expect(screen.getByText('state.not-installed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'action.install' }))
    expect(action.mutate).toHaveBeenCalledWith('install')
  })

  it('renders the Download Center chrome with Library and Activity faces', () => {
    renderPage()
    expect(screen.getByTestId('managed-resources-page')).toBeTruthy()
    expect(screen.getByText('tab.library')).toBeTruthy()
    expect(screen.getByText('tab.activity')).toBeTruthy()
  })

  it('renders external/update/error owner projections without OpenCode-specific controls', () => {
    resourceState.resources = [resource({
      state: 'update-available',
      installationSource: 'managed',
      installedVersion: '1.16.0',
      actions: {
        install: { available: false, reasonCode: 'managed_resource_already_installed' },
        update: { available: true, reasonCode: null },
        uninstall: { available: false, reasonCode: 'opencode_runtime_in_use' },
      },
    })]
    action.isError = true
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'action.update' }))
    expect(action.mutate).toHaveBeenCalledWith('update')
    expect(screen.getByText('action.failed')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
