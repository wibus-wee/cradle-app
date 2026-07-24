// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DownloadTaskRow } from './download-center-chrome'
import type { DownloadTask } from './types'

const { openResources, openSettingsSection } = vi.hoisted(() => ({
  openResources: vi.fn(),
  openSettingsSection: vi.fn(),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('~/navigation/navigation-commands', () => ({ openResources, openSettingsSection }))
vi.mock('./use-download-center', () => ({ useDownloadCenterCancel: () => vi.fn() }))

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    taskId: 'task-1',
scope: 'server',
owner: { namespace: 'chronicle', resourceType: 'model-resource', resourceId: 'audio-asr', displayName: 'Chronicle model' },
fileName: 'model.bin',
sourceId: null,
    status: 'failed',
transferredBytes: 0,
totalBytes: null,
attempts: 1,
maxAttempts: 3,
    error: { code: 'NETWORK', message: 'Request timed out', retryable: true },
result: null,
    createdAt: '2026-01-01T00:00:00.000Z',
updatedAt: '2026-01-01T00:00:00.000Z',
startedAt: null,
finishedAt: null,
    ...overrides,
  }
}

describe('download center chrome', () => {
  it('navigates the retry action to the owning feature and never displays Bearer details', () => {
    render(<DownloadTaskRow task={task({ error: { code: 'updater_error', message: 'Authorization: Bearer secret-token', retryable: true } })} />)
    fireEvent.click(screen.getByText('download.action.openOwnerRetry'))
    expect(openResources).toHaveBeenCalledOnce()
    expect(screen.getByText(/download.error.last/).textContent).toContain('download.error.network')
    expect(screen.queryByText(/Bearer secret-token/)).toBeNull()
  })

  it('uses an accessible progressbar and a 40px cancellation hit target', () => {
    render(<DownloadTaskRow task={task({ status: 'downloading', transferredBytes: 25, totalBytes: 100, error: null })} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')
    expect(screen.getByRole('button', { name: 'download.action.cancel' }).className).toContain('size-10')
  })
})
