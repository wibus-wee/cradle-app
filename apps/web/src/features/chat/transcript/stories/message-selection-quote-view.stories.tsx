import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { MessageSelectionQuoteView } from '../views/message-selection-quote-view'

const sampleCode = `.message-body code {
  background: color-mix(in srgb, var(--muted) 76%, transparent);
  padding: 0.15em 0.35em;
  border-radius: 4px;
}`

function MessageSelectionQuoteScene() {
  const [quoted, setQuoted] = useState(false)

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="relative mx-auto max-w-xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="max-w-lg text-sm leading-relaxed text-foreground">
          Select part of a response and use the floating action to bring it back into the composer as a Markdown quote.
          The popover must fully occlude whatever sits beneath it, including highlighted text.
        </p>
        {/* Simulated text selection highlight directly behind the floating action. */}
        <p className="mt-4 max-w-lg text-sm leading-relaxed">
          <mark className="bg-primary/25 text-foreground rounded-sm box-decoration-clone px-0.5">
            This span pretends to be an active selection. Nothing of it may shine
            through the quote popover floating above.
          </mark>
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed text-foreground">
          <code>{sampleCode}</code>
        </pre>
        <MessageSelectionQuoteView
          top={132}
          left={56}
          label="Quote selection"
          onQuote={() => setQuoted(true)}
        />
        {quoted && (
          <output className="mt-6 block text-xs text-muted-foreground">
            Quote inserted into composer.
          </output>
        )}
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Transcript/MessageSelectionQuoteView',
  component: MessageSelectionQuoteScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Props-only floating action for quoting a selected message range. Rendered over dense content and a simulated selection highlight to prove the surface is fully opaque.',
      },
    },
  },
} satisfies Meta<typeof MessageSelectionQuoteScene>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
