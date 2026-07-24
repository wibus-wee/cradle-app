import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'
import { I18nProvider } from '~/i18n/client'

import { MessageBubble } from '../rendering/message-bubble'
import { buildOptimisticUserMessage } from '../session/optimistic-chat-turn'
import { Composer } from './composer'

afterEach(cleanup)

const largePaste = Array.from({ length: 25 }, (_, index) => `pasted line ${index + 1}`).join('\n')

function pasteLargeText(editor: HTMLElement) {
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? largePaste : ''),
    },
  })
}

function PastedTextLifecycleHarness({
  onSubmit,
}: {
  onSubmit: (message: UIMessage, submittedText: string) => void
}) {
  const [message, setMessage] = useState<UIMessage | null>(null)

  return (
    <I18nProvider initialLocale="en-US">
      <TooltipProvider>
        <Composer
          send={{
            submit: (text) => {
              const nextMessage = buildOptimisticUserMessage({ messageId: 'user-1', text })
              setMessage(nextMessage)
              onSubmit(nextMessage, text)
              return true
            },
          }}
          testIds={{ textarea: 'composer-editor', sendButton: 'composer-send' }}
          accessibility={{ textareaAriaLabel: 'Message', sendButtonAriaLabel: 'Send message' }}
        />
        {message
? (
          <MessageBubble message={message} isStreaming={false} sessionId="session-1" />
        )
: null}
      </TooltipProvider>
    </I18nProvider>
  )
}

describe('pasted-text lifecycle', () => {
  it('moves a large paste from composer card through send into expandable history', async () => {
    const onSubmit = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<PastedTextLifecycleHarness onSubmit={onSubmit} />)

    const editor = await screen.findByTestId('composer-editor')
    pasteLargeText(editor)

    expect(await screen.findByTestId('composer-pasted-text-card')).not.toBeNull()
    expect(editor.textContent).not.toContain('pasted line 1')

    fireEvent.click(screen.getByRole('button', { name: 'Preview pasted text' }))
    expect(screen.getByLabelText('Preview pasted text').textContent).toBe(largePaste)
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('composer-send'))
    expect(onSubmit).toHaveBeenCalledOnce()

    const submittedText = onSubmit.mock.calls[0]?.[1] ?? ''
    expect(submittedText).toContain('<pasted_text>')
    expect(submittedText).toContain('pasted line 25')

    const historyCard = await screen.findByTestId('history-pasted-text-card')
    expect(document.body.textContent).not.toContain('<pasted_text>')
    expect(document.body.textContent).not.toContain('[{"text"')

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(largePaste))

    fireEvent.click(within(historyCard).getByRole('button', { name: 'Expand pasted text' }))
    expect(within(historyCard).getByLabelText('Preview pasted text').textContent).toBe(largePaste)
  })

  it('restores a composer card into the editor without sending', async () => {
    const onSubmit = vi.fn()
    render(<PastedTextLifecycleHarness onSubmit={onSubmit} />)

    const editor = await screen.findByTestId('composer-editor')
    pasteLargeText(editor)
    expect(await screen.findByTestId('composer-pasted-text-card')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restore pasted text to the editor' }))

    expect(screen.queryByTestId('composer-pasted-text-card')).toBeNull()
    expect(editor.textContent).toContain('pasted line 1')
    expect(editor.textContent).toContain('pasted line 25')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('removes a composer card without inserting or sending it', async () => {
    const onSubmit = vi.fn()
    render(<PastedTextLifecycleHarness onSubmit={onSubmit} />)

    const editor = await screen.findByTestId('composer-editor')
    pasteLargeText(editor)
    expect(await screen.findByTestId('composer-pasted-text-card')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Remove pasted text' }))

    expect(screen.queryByTestId('composer-pasted-text-card')).toBeNull()
    expect(editor.textContent).not.toContain('pasted line 1')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
