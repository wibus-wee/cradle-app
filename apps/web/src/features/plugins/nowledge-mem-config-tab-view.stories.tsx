import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import {
  localNowledgeConfigFixture,
  remoteNowledgeConfigFixture,
} from '../../../../../plugins/nowledge-mem/src/web/fixtures/config'
import { ConfigTabView } from '../../../../../plugins/nowledge-mem/src/web/tabs/config-tab-view'

const meta = {
  title: 'Plugins/Nowledge Mem/ConfigTabView',
  component: ConfigTabView,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    config: localNowledgeConfigFixture,
    loading: false,
    error: null,
    onRefresh: fn(async () => {}),
    onSave: fn(async () => localNowledgeConfigFixture),
  },
} satisfies Meta<typeof ConfigTabView>

export default meta
type Story = StoryObj<typeof meta>

export const Local: Story = {}

export const RemoteWithStoredKey: Story = {
  args: {
    config: remoteNowledgeConfigFixture,
    onSave: fn(async () => remoteNowledgeConfigFixture),
  },
}

export const Disabled: Story = {
  args: {
    config: {
      ...localNowledgeConfigFixture,
      enabled: false,
    },
  },
}

export const Loading: Story = {
  args: {
    config: null,
    loading: true,
  },
}

export const Error: Story = {
  args: {
    config: null,
    error: 'Plugin configuration is unavailable.',
  },
}
