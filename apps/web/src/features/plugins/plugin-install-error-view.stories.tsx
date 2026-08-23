import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { PluginInstallErrorView } from './plugin-install-error-view'

const meta = {
  title: 'Plugins/Install/Error',
  component: PluginInstallErrorView,
  decorators: [
    Story => (
      <main className="w-full p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    message: 'The repository was found, but it does not contain a Cradle plugin manifest.',
    onRetry: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof PluginInstallErrorView>

export default meta

type Story = StoryObj<typeof meta>

export const InvalidPlugin: Story = {}

export const NetworkFailure: Story = {
  args: {
    message: 'The plugin source could not be reached. Check the network connection and retry.',
  },
}

export const RepoNotFound: Story = {
  args: {
    message: 'Couldn\'t find that repository. Check the owner/repo name or whether it is private.',
  },
}
