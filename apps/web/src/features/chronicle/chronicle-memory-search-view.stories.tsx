import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleMemorySearchView } from './chronicle-memory-search-view'
import { chronicleMemoryFixtures } from './fixtures/chronicle-memory-knowledge'

const meta = {
  title: 'App/Chronicle/Memory Search',
  component: ChronicleMemorySearchView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    query: '',
    loading: false,
    entries: chronicleMemoryFixtures,
    focusedMemoryId: null,
    onQueryChange: fn(),
  },
} satisfies Meta<typeof ChronicleMemorySearchView>

export default meta
type Story = StoryObj<typeof meta>

export const Results: Story = {}

export const FocusedResult: Story = {
  args: {
    focusedMemoryId: chronicleMemoryFixtures[1].id,
  },
}

export const SemanticSearch: Story = {
  args: {
    query: 'rendering seam',
    entries: chronicleMemoryFixtures.slice(0, 1),
  },
}

export const NoMatches: Story = {
  args: {
    query: 'missing result',
    entries: [],
  },
}

export const Empty: Story = {
  args: {
    entries: [],
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    entries: [],
  },
}
