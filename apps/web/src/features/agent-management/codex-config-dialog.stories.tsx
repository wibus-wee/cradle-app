import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Dialog } from '~/components/ui/dialog'

import { CodexConfigDialogFrame } from './codex-config-dialog'
import { CodexConfigView } from './codex-config-view'
import { fixtureSchema } from './codex-config-view.stories'

const meta = {
  title: 'Agent Management/CodexConfigDialog',
  decorators: [
    Story => (
      <div className="min-h-screen bg-muted/20 p-10 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  render: () => (
    <Dialog open>
      <CodexConfigDialogFrame>
        <CodexConfigView
          schema={fixtureSchema}
          initialValue={JSON.stringify(
            {
              web_search: 'live',
              tui: { alternate_screen: 'never' },
            },
            null,
            2,
          )}
          onSave={fn(async () => undefined)}
        />
      </CodexConfigDialogFrame>
    </Dialog>
  ),
}
