import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '~/i18n/client'

import { SupportSettings } from './support-settings'

const native = vi.hoisted(() => ({
  getCradleDataPaths: vi.fn(async () => ({
    userDataPath: 'C:/Users/test/AppData/Roaming/Cradle',
    serverDataPath: 'C:/Users/test/AppData/Roaming/Cradle/data',
    databasePath: 'C:/Users/test/AppData/Roaming/Cradle/data/cradle.db',
    serverLogPath: 'C:/Users/test/AppData/Roaming/Cradle/data/server.log',
    serverDataSource: 'default' as const,
    migration: { phase: 'idle', sourceRoot: null, targetRoot: null, backupRoot: null, errorMessage: null },
  })),
  showItemInFolder: vi.fn(async () => {}),
  chooseCradleDataDirectory: vi.fn(async () => ({ canceled: false, filePath: 'E:/CradleData' })),
  scheduleCradleDataDirectoryMigration: vi.fn(async () => ({ scheduled: true, targetPath: 'E:/CradleData', restartRequired: true as const })),
}))

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:21423',
  isElectron: true,
  nativeIpc: { native },
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getObservabilityExport: vi.fn(async () => ({ data: null })),
  postObservabilityFlush: vi.fn(async () => {}),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('supportSettings data directory controls', () => {
  it('chooses a target, confirms migration, and schedules a restart', async () => {
    render(
      <I18nProvider initialLocale="en-US">
        <SupportSettings />
      </I18nProvider>,
    )

    await waitFor(() => expect(native.getCradleDataPaths).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Change location' }))
    await waitFor(() => expect(native.chooseCradleDataDirectory).toHaveBeenCalled())
    expect(await screen.findByText('Change Cradle data location?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy and restart' }))
    await waitFor(() => expect(native.scheduleCradleDataDirectoryMigration).toHaveBeenCalledWith('E:/CradleData'))
  })
})
