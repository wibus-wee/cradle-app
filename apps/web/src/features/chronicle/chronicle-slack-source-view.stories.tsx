import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleSlackSourceView } from './chronicle-slack-source-view'
import { chronicleSlackSourceFixtures } from './fixtures/chronicle-slack-sources'

const meta = {
  title: 'App/Chronicle/Slack Sources',
  component: ChronicleSlackSourceView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-5xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    loading: false,
    sources: chronicleSlackSourceFixtures,
    serverUrl: 'http://127.0.0.1:21423',
    saving: false,
    syncing: false,
    onSaveSource: fn(async () => chronicleSlackSourceFixtures[0]),
    onSyncSource: fn(async sourceId => ({
      sourceId,
      status: 'success' as const,
      ingested: 12,
      message: 'Slack sync completed',
    })),
  },
} satisfies Meta<typeof ChronicleSlackSourceView>

export default meta
type Story = StoryObj<typeof meta>

export const ConnectedSources: Story = {}

export const Empty: Story = {
  args: {
    sources: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    sources: [],
  },
}

export const Busy: Story = {
  args: {
    saving: true,
    syncing: true,
  },
}
