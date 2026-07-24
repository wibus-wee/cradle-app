import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChronicleResourceGridView } from './chronicle-resource-grid-view'
import { chronicleResourceFixtures } from './fixtures/chronicle-resources'

const resolveResource = async (
  category: (typeof chronicleResourceFixtures)[number]['category'],
) => ({
  ...chronicleResourceFixtures.find(resource => resource.category === category)
  ?? chronicleResourceFixtures[0],
  message: 'Fixture action completed.',
})

const meta = {
  title: 'App/Chronicle/Model Resources',
  component: ChronicleResourceGridView,
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
    resources: chronicleResourceFixtures,
    busy: false,
    downloadProgress: {},
    onInstallAll: fn(),
    onReconcile: fn(),
    onInstallResource: fn(resolveResource),
    onVerifyResource: fn(resolveResource),
  },
} satisfies Meta<typeof ChronicleResourceGridView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedStates: Story = {}

export const ReadyAndMissing: Story = {
  args: {
    resources: chronicleResourceFixtures.slice(0, 2),
  },
}

export const InstallingAndError: Story = {
  args: {
    resources: chronicleResourceFixtures.slice(2, 5),
    downloadProgress: {
      'audio-asr': 64,
    },
  },
}

export const Busy: Story = {
  args: {
    resources: chronicleResourceFixtures.slice(1, 4),
    busy: true,
    downloadProgress: {
      'audio-vad': 28,
    },
  },
}

export const Loading: Story = {
  args: {
    loading: true,
    resources: [],
  },
}
