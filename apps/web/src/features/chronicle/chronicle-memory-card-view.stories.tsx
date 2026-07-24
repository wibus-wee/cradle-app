import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleMemoryCardView } from './chronicle-memory-card-view'
import { chronicleMemoryFixtures } from './fixtures/chronicle-memory-knowledge'

const meta = {
  title: 'App/Chronicle/Memory Card',
  component: ChronicleMemoryCardView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-2xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    entry: chronicleMemoryFixtures[0],
    focused: false,
  },
} satisfies Meta<typeof ChronicleMemoryCardView>

export default meta
type Story = StoryObj<typeof meta>

export const SemanticMatch: Story = {}

export const HybridMatch: Story = {
  args: {
    entry: chronicleMemoryFixtures[1],
  },
}

export const Focused: Story = {
  args: {
    entry: chronicleMemoryFixtures[1],
    focused: true,
  },
}

export const FallbackTitle: Story = {
  args: {
    entry: chronicleMemoryFixtures[2],
  },
}
