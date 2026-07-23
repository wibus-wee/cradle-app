import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { pluginPreviewFixture } from './fixtures/plugin-install'
import { PluginInstallReviewView } from './plugin-install-review-view'

const meta = {
  title: 'Plugins/Install/Review',
  component: PluginInstallReviewView,
  decorators: [
    Story => (
      <main className="mx-auto w-full max-w-2xl p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    preview: pluginPreviewFixture,
    selected: new Set([0, 1]),
    sourceLabel: 'Example plugin suite',
    installing: false,
    onToggle: fn(),
    onSelectAll: fn(),
    onSelectNone: fn(),
    onBack: fn(),
    onInstall: fn(),
  },
} satisfies Meta<typeof PluginInstallReviewView>

export default meta

type Story = StoryObj<typeof meta>

export const AllSelected: Story = {}

export const PartiallySelected: Story = {
  args: {
    selected: new Set([0]),
  },
}

export const Installing: Story = {
  args: {
    installing: true,
  },
}

export const EmptySource: Story = {
  args: {
    preview: {
      ...pluginPreviewFixture,
      plugins: [],
      warnings: [],
    },
    selected: new Set(),
  },
}
