import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataBackupSettingsViewCopy } from './data-backup-settings-view'
import { DataBackupSettingsView } from './data-backup-settings-view'

const copy = {
  title: 'Backup & Restore',
  description: 'Move your data.',
  badge: 'Local',
  noticeTitle: 'Keep the backup private',
  noticeDescription: 'The archive contains private data.',
  exportLabel: 'Export data',
  exportDescription: 'Create a backup archive.',
  exportAction: 'Export backup',
  restoreLabel: 'Restore data',
  restoreDescription: 'Restore a backup archive.',
  restoreAction: 'Choose backup',
  unavailable: 'Desktop only.',
  showExport: 'Show in folder',
  confirmTitle: 'Replace local data?',
  confirmDescription: 'Cradle will restart.',
  confirmCancel: 'Cancel',
  confirmAction: 'Restore and restart',
} satisfies DataBackupSettingsViewCopy

afterEach(cleanup)

function renderView(exportedArchivePath: string | null) {
  const onShowExport = vi.fn()
  render(
    <DataBackupSettingsView
      copy={copy}
      available
      busy={false}
      statusMessage="Backup exported successfully."
      statusTone="neutral"
      exportedArchivePath={exportedArchivePath}
      pendingRestorePath={null}
      onExport={vi.fn()}
      onChooseRestore={vi.fn()}
      onShowExport={onShowExport}
      onCancelRestore={vi.fn()}
      onConfirmRestore={vi.fn()}
    />,
  )
  return onShowExport
}

describe('dataBackupSettingsView', () => {
  it('reveals a completed export from its success status', () => {
    const onShowExport = renderView('/Users/test/Cradle Backup.cradle-backup')

    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))

    expect(onShowExport).toHaveBeenCalledOnce()
  })

  it('does not offer a reveal action without an exported archive', () => {
    renderView(null)

    expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull()
  })
})
