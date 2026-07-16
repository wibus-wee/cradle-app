import { AnimatePresence } from 'motion/react'

import { HistoryPastedTextCard } from '../pasted-text/pasted-text-card'
import { readUserTextDisplay } from './message-bubble-selectors'

export function UserMessageText({ text }: { text: string }) {
  const projection = readUserTextDisplay(text)

  return (
    <>
      {projection.displayText.length > 0 && (
        <span className="whitespace-pre-wrap wrap-break-word">{projection.displayText}</span>
      )}
      {projection.pastedTexts.length > 0 && (
        <div>
          <AnimatePresence initial={false}>
            {projection.pastedTexts.map(pastedText => (
              <HistoryPastedTextCard key={pastedText.id} pastedText={pastedText} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  )
}
