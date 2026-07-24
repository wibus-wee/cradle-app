import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleKnowledgeCardGridView } from './chronicle-knowledge-card-grid-view'
import { chronicleKnowledgeCardFixtures } from './fixtures/chronicle-memory-knowledge'

const meta = {
  title: 'App/Chronicle/Knowledge Cards',
  component: ChronicleKnowledgeCardGridView,
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
    cards: chronicleKnowledgeCardFixtures,
    focusedKnowledgeId: null,
  },
} satisfies Meta<typeof ChronicleKnowledgeCardGridView>

export default meta
type Story = StoryObj<typeof meta>

export const ActiveAndArchived: Story = {}

export const Focused: Story = {
  args: {
    focusedKnowledgeId: chronicleKnowledgeCardFixtures[0].id,
  },
}

export const Empty: Story = {
  args: {
    cards: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    cards: [],
  },
}
