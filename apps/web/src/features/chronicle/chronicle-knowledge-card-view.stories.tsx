import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleKnowledgeCardView } from './chronicle-knowledge-card-view'
import { chronicleKnowledgeCardFixtures } from './fixtures/chronicle-memory-knowledge'

const meta = {
  title: 'App/Chronicle/Knowledge Card',
  component: ChronicleKnowledgeCardView,
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
    card: chronicleKnowledgeCardFixtures[0],
    focused: false,
  },
} satisfies Meta<typeof ChronicleKnowledgeCardView>

export default meta
type Story = StoryObj<typeof meta>

export const ActiveDecision: Story = {}

export const ArchivedPattern: Story = {
  args: {
    card: chronicleKnowledgeCardFixtures[1],
  },
}

export const Focused: Story = {
  args: {
    focused: true,
  },
}
