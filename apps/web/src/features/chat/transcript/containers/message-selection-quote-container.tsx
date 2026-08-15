import { AnimatePresence } from 'motion/react'
import type { RefObject } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { requestComposerInsert } from '../../composer/composer-insert'
import { formatSelectionAsQuote, readMessageSelection } from '../lib/message-selection'
import { MessageSelectionQuoteView } from '../views/message-selection-quote-view'

interface MessageSelectionQuoteContainerProps {
  sessionId: string
  rootRef: RefObject<HTMLDivElement | null>
}

interface QuoteSelectionState {
  selectedText: string
  top: number
  left: number
}

const QUOTE_ACTION_WIDTH = 120
const QUOTE_ACTION_HEIGHT = 30
const VIEWPORT_INSET = 8

function readActionPosition(focusRect: DOMRect): { top: number, left: number } {
  // Anchor to the focus end of the selection (where the pointer was
  // released): the toolbar sits near the cursor, not the line start.
  // Prefer above the selection; flip below when there is no room.
  const aboveTop = focusRect.top - QUOTE_ACTION_HEIGHT - 6
  const top = aboveTop >= VIEWPORT_INSET ? aboveTop : focusRect.bottom + 6
  const maxLeft = Math.max(VIEWPORT_INSET, window.innerWidth - QUOTE_ACTION_WIDTH - VIEWPORT_INSET)
  const centeredLeft = focusRect.left + focusRect.width / 2 - QUOTE_ACTION_WIDTH / 2

  return {
    top: Math.max(VIEWPORT_INSET, top),
    left: Math.min(Math.max(VIEWPORT_INSET, centeredLeft), maxLeft),
  }
}

/** Runtime adapter that turns a document selection into a composer insertion. */
export function MessageSelectionQuoteContainer({
  sessionId,
  rootRef,
}: MessageSelectionQuoteContainerProps) {
  const { t } = useTranslation('chat')
  const [selection, setSelection] = useState<QuoteSelectionState | null>(null)

  const dismiss = useCallback(() => {
    setSelection(null)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    let frame: number | null = null
    const refresh = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      frame = window.requestAnimationFrame(() => {
        frame = null
        const messageSelection = readMessageSelection(root, window.getSelection())
        if (!messageSelection) {
          setSelection(null)
          return
        }

        setSelection({
          selectedText: messageSelection.selectedText,
          ...readActionPosition(messageSelection.focusRect),
        })
      })
    }

    document.addEventListener('selectionchange', refresh)
    // Reposition instead of dismissing: the selection survives scrolling,
    // only its viewport rect changes.
    root.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', dismiss)
    refresh()

    return () => {
      document.removeEventListener('selectionchange', refresh)
      root.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', dismiss)
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [dismiss, rootRef])

  return createPortal(
    <AnimatePresence initial={false}>
      {selection
        ? (
            <MessageSelectionQuoteView
              key="message-selection-quote"
              top={selection.top}
              left={selection.left}
              label={t('messageSelection.quote')}
              onQuote={() => {
                const text = formatSelectionAsQuote(selection.selectedText)
                if (!text) {
                  dismiss()
                  return
                }
                requestComposerInsert(sessionId, text)
                window.getSelection()?.removeAllRanges()
                dismiss()
              }}
            />
          )
        : null}
    </AnimatePresence>,
    document.body,
  )
}
