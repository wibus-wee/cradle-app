import { Settings2Line as SettingsIcon } from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { ComposerView } from '../views/composer-view'
import { DraftChatComposerView } from '../views/draft-chat-composer-view'
import { DraftChatReadinessNoticeView } from '../views/draft-chat-readiness-notice-view'

function DraftChatComposerScene({ needsSetup }: { needsSetup: boolean }) {
  const [activity, setActivity] = useState('')

  return (
    <main className="flex min-h-[32rem] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-3xl space-y-3">
        <DraftChatComposerView
          composer={(
            <ComposerView
              send={{
                submit: (text) => {
                  setActivity(`Sent ${text.length} characters`)
                  return true
                },
                sendDisabled: needsSetup,
              }}
              view={{
                placeholder: needsSetup ? 'Configure a provider to start' : 'Describe the work to start',
                textareaRows: 5,
              }}
              accessibility={{ textareaAriaLabel: 'New chat message', sendButtonAriaLabel: 'Send message' }}
            />
          )}
          notice={(
            <DraftChatReadinessNoticeView
              notice={needsSetup
                ? {
                    key: 'providers',
                    icon: SettingsIcon,
                    message: 'Add a provider before starting a new chat.',
                    actionLabel: 'Open settings',
                    disabled: false,
                  }
                : null}
              onAction={section => setActivity(`Opened ${section}`)}
              testIdPrefix="draft-chat-story"
            />
          )}
        />
        {activity && <p className="px-1 text-xs text-muted-foreground" role="status">{activity}</p>}
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Composer/DraftChatComposerView',
  component: DraftChatComposerScene,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { needsSetup: false },
} satisfies Meta<typeof DraftChatComposerScene>

export default meta

type Story = StoryObj<typeof meta>

export const Ready: Story = { args: { needsSetup: false } }
export const ProviderSetupRequired: Story = { args: { needsSetup: true } }
