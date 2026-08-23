import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { PluginInstallPasteView } from './plugin-install-paste-view'

const meta = {
  title: 'Plugins/Install/Paste',
  component: PluginInstallPasteView,
  decorators: [
    Story => (
      <main className="w-full p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    input: 'cradle-app/official-plugins',
    parsed: {
      kind: 'git',
      location: 'cradle-app/official-plugins',
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

export const Empty: Story = {
  args: {
    input: '',
    parsed: null,
  },
}

export const RecognizedGitHub: Story = {}

export const RecognizedNpm: Story = {
  args: {
    input: '@cradle/browser-use',
    parsed: {
      kind: 'npm',
      location: '@cradle/browser-use',
    },
  },
}

export const RecognizedCradleLink: Story = {
  args: {
    input: 'cradle://plugins/install?source=github&repository=owner/repo',
    parsed: {
      kind: 'git',
      location: 'owner/repo',
    },
  },
}

export const InvalidInput: Story = {
  args: {
    input: 'not a plugin source at all ???',
    parsed: null,
    looksLikeLocalPath: false,
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
