import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import {
  installedPluginFixture,
  pluginInstallResultFixture,
} from './fixtures/plugin-install'
import { PluginInstallDoneView } from './plugin-install-done-view'

const meta = {
  title: 'Plugins/Install/Done',
  component: PluginInstallDoneView,
  decorators: [
    Story => (
      <main className="w-full p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    result: pluginInstallResultFixture,
    serverUrl: 'http://localhost:21423',
    enablingRouteSegment: null,
    undoing: false,
    onEnable: fn(),
    onUndo: fn(),
    onDone: fn(),
  },
} satisfies Meta<typeof PluginInstallDoneView>

export default meta

type Story = StoryObj<typeof meta>

export const Installed: Story = {}

export const SinglePlugin: Story = {
  args: {
    result: {
      ...pluginInstallResultFixture,
      source: {
        ...pluginInstallResultFixture.source,
        plugins: [installedPluginFixture],
      },
      discoveredPlugins: [installedPluginFixture],
    },
  },
}

export const EnablingPlugin: Story = {
  args: {
    enablingRouteSegment: 'slack-conversation-bridge',
  },
}

export const Undoing: Story = {
  args: {
    undoing: true,
  },
}

export const NoPluginsDiscovered: Story = {
  args: {
    result: {
      ...pluginInstallResultFixture,
      source: {
        ...pluginInstallResultFixture.source,
        plugins: [],
      },
      discoveredPlugins: [],
    },
  },
}
