import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { MessageBubbleActionsView } from '../views/message-bubble-actions-view'

function MessageBubbleActionsScene() {
  const [activity, setActivity] = useState('No message action selected')

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-xl">
        <div className="group rounded-lg border border-border bg-card p-4">
          <p className="text-sm leading-relaxed text-foreground">
            The transcript now has stable rendering seams for message actions and shared tool activity.
          </p>
          <MessageBubbleActionsView
            hasPlainText
            isUser
            editAction={{
              busy: false,
              disabled: false,
              label: 'Edit previous message',
              title: 'Edit and resend',
              onEdit: () => setActivity('edit'),
            }}
            onCopy={() => setActivity('copy')}
            onPin={() => setActivity('pin')}
            onMarkSelection={() => setActivity('mark selection')}
            forceVisible
          />
        </div>
        <output className="mt-4 block text-xs text-muted-foreground">{activity}</output>
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Transcript/MessageBubbleActionsView',
  component: MessageBubbleActionsScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Props-only message action surface. The runtime adapter owns store reads, pinning, markers, and toast reporting.',
      },
    },
  },
} satisfies Meta<typeof MessageBubbleActionsScene>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
