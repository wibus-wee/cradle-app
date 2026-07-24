import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

import type { ComposerStoryState } from '../fixtures/composer-view-fixtures'
import {
  composerAttachmentFixtures,
  composerDraftFixture,
} from '../fixtures/composer-view-fixtures'
import type { ComposerProps } from '../views/composer-view'
import { ComposerView } from '../views/composer-view'

function ComposerStateScene({ state }: { state: ComposerStoryState }) {
  const [activity, setActivity] = useState('No composer action selected')
  const props = useMemo<ComposerProps>(() => ({
    send: {
      submit: (text, files) => {
        setActivity(`Sent ${text.length} characters with ${files.length} attachments`)
        return true
      },
      stop: () => setActivity('Stopped generation'),
      isStreaming: state === 'streaming',
      isSending: state === 'sending',
      disabled: state === 'disabled',
      sendDisabled: state === 'disabled',
    },
    attachments: {
      supportsAttachments: true,
      acceptsNativeFiles: false,
      appendFileParts: state === 'attachments' ? composerAttachmentFixtures : undefined,
      appendFilePartsKey: state === 'attachments' ? 1 : 0,
    },
    slots: {
      toolbar: (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Badge variant="secondary">Codex</Badge>
          <span>GPT-5</span>
        </div>
      ),
      contextBar: <Button variant="ghost" size="xs">Cradle App</Button>,
      footer: <span className="text-[11px] text-muted-foreground">Local workspace</span>,
    },
    externalSignals: {
      replaceText: state === 'empty'
        ? ''
        : composerDraftFixture,
      replaceTextKey: 1,
    },
    view: {
      placeholder: state === 'disabled' ? 'Composer unavailable' : 'Message Cradle...',
      textareaRows: 3,
      sessionTokens: state === 'streaming' ? 48_200 : 12_400,
      sessionContextWindow: 128_000,
    },
    accessibility: {
      textareaAriaLabel: 'Chat message',
      sendButtonAriaLabel: 'Send message',
    },
  }), [state])

  return (
    <main className="flex min-h-[32rem] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-2xl space-y-4">
        <ComposerView {...props} />
        <div className="px-1 text-xs text-muted-foreground" role="status">{activity}</div>
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Composer/ComposerView',
  component: ComposerStateScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
  args: {
    state: 'draft',
  },
} satisfies Meta<typeof ComposerStateScene>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { state: 'empty' } }
export const Draft: Story = { args: { state: 'draft' } }
export const Attachments: Story = { args: { state: 'attachments' } }
export const Streaming: Story = { args: { state: 'streaming' } }
export const Sending: Story = { args: { state: 'sending' } }
export const Disabled: Story = { args: { state: 'disabled' } }
