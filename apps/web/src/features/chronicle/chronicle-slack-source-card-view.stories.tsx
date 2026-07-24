import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleSlackSourceCardView } from './chronicle-slack-source-card-view'
import { chronicleSlackSourceFixtures } from './fixtures/chronicle-slack-sources'

const meta = {
  title: 'App/Chronicle/Slack Source Card',
  component: ChronicleSlackSourceCardView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    source: chronicleSlackSourceFixtures[0],
    serverUrl: 'http://127.0.0.1:21423',
    syncing: false,
    onSync: fn(),
  },
} satisfies Meta<typeof ChronicleSlackSourceCardView>

export default meta
type Story = StoryObj<typeof meta>

export const EventsApi: Story = {}

export const Polling: Story = {
  args: {
    source: chronicleSlackSourceFixtures[1],
  },
}

export const Error: Story = {
  args: {
    source: chronicleSlackSourceFixtures[2],
  },
}
