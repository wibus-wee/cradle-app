import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '~/i18n/client'

import { createComposerPastedText } from './pasted-text'
import { ComposerPastedTextCard, HistoryPastedTextCard } from './pasted-text-card'

afterEach(cleanup)

const pastedText = createComposerPastedText('alpha\nbeta\ngamma', 'paste-1')

function renderWithI18n(node: React.ReactNode) {
  return render(<I18nProvider initialLocale="en-US">{node}</I18nProvider>)
}

describe('pasted-text cards', () => {
  it('previews composer content without restoring or removing it', async () => {
    const onRestore = vi.fn()
    const onRemove = vi.fn()
    renderWithI18n(
      <ComposerPastedTextCard pastedText={pastedText} onRestore={onRestore} onRemove={onRemove} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Preview pasted text' }))

    expect(screen.getByLabelText('Preview pasted text').textContent).toBe(pastedText.text)
    expect(onRestore).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Restore pasted text to the editor' }))
    expect(onRestore).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('previews sent-message content in a popover without expanding layout', async () => {
    renderWithI18n(<HistoryPastedTextCard pastedText={pastedText} />)

    const preview = await screen.findByRole('button', { name: 'Preview pasted text' })
    expect(screen.queryByLabelText('Preview pasted text')).toBe(preview)

    fireEvent.click(preview)
    expect(screen.getByLabelText('Preview pasted text').textContent).toBe(pastedText.text)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse pasted text' }))
    expect(screen.queryByRole('button', { name: 'Collapse pasted text' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview pasted text' })).not.toBeNull()
  })
})
