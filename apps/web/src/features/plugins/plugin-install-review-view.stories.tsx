import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { pluginPreviewFixture } from './fixtures/plugin-install'
import { PluginInstallReviewView } from './plugin-install-review-view'

const meta = {
  title: 'Plugins/Install/Review',
  component: PluginInstallReviewView,
  decorators: [
    Story => (
      <main className="w-full p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    preview: pluginPreviewFixture,
    selected: new Set([0, 1, 2, 3]),
    sourceLabel: 'Official plugin suite',
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
    selected: new Set([0, 2]),
  },
}

export const NoneSelected: Story = {
  args: {
    selected: new Set(),
  },
}

export const WithWarnings: Story = {
  args: {
    preview: {
      ...pluginPreviewFixture,
      warnings: [
        'Two plugins require trust confirmation before they can be enabled.',
        'slack-conversation-bridge requests secrets.read — review the bot token scope.',
      ],
    },
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
