import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleStatusPanelView } from './chronicle-status-panel-view'
import {
  chronicleConfigFixture,
  chronicleRunningStatusFixture,
  chronicleStoppedStatusFixture,
} from './fixtures/chronicle-status'

const meta = {
  title: 'App/Chronicle/Status Panel',
  component: ChronicleStatusPanelView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-7xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    loading: false,
    status: chronicleRunningStatusFixture,
    config: chronicleConfigFixture,
    modelLabel: 'OpenAI / gpt-5.2',
  },
} satisfies Meta<typeof ChronicleStatusPanelView>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const StoppedWithError: Story = {
  args: {
    status: chronicleStoppedStatusFixture,
  },
}

export const NotConfigured: Story = {
  args: {
    status: null,
    config: null,
    modelLabel: null,
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    status: null,
  },
}
