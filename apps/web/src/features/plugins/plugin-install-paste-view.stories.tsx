import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { PluginInstallPasteView } from './plugin-install-paste-view'

const meta = {
  title: 'Plugins/Install/Paste',
  component: PluginInstallPasteView,
  decorators: [
    Story => (
      <main className="mx-auto w-full max-w-xl p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    input: 'cradle-app/example-plugin',
    parsed: {
      kind: 'git',
      location: 'cradle-app/example-plugin',
    },
    looksLikeLocalPath: false,
    pending: false,
    onChange: fn(),
    onPreview: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof PluginInstallPasteView>

export default meta

type Story = StoryObj<typeof meta>

export const RecognizedGitHub: Story = {}

export const RecognizedNpm: Story = {
  args: {
    input: '@cradle/example-plugin',
    parsed: {
      kind: 'npm',
      location: '@cradle/example-plugin',
    },
  },
}

export const LocalPathRejected: Story = {
  args: {
    input: '/Users/dev/example-plugin',
    parsed: null,
    looksLikeLocalPath: true,
  },
}

export const Resolving: Story = {
  args: {
    pending: true,
  },
}
