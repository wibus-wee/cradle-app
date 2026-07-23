import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { BrowserPanelTabStripView } from './browser-panel-tab-strip-view'
import {
  browserLoadingTabFixture,
  browserPanelTabFixtures,
} from './fixtures/browser-panel-tabs'

const meta = {
  title: 'App/Browser/Panel Tab Strip',
  component: BrowserPanelTabStripView,
  decorators: [
    Story => (
      <main className="h-screen min-h-40 bg-background">
        <Story />
      </main>
    ),
  ],
  args: {
    tabs: browserPanelTabFixtures.slice(0, 6),
    activeTabId: browserPanelTabFixtures[0].id,
    activeSessionId: 'session-current',
    discardPromptTabId: null,
    contextUsageAvailable: true,
    onSelectTab: fn(),
    onRequestCloseTab: fn(),
    onDiscardPromptChange: fn(),
    onDiscardTab: fn(),
    onNewTab: fn(),
    onOpenContextUsage: fn(),
  },
} satisfies Meta<typeof BrowserPanelTabStripView>

export default meta
type Story = StoryObj<typeof meta>

export const MixedTabs: Story = {}

export const AllTabKinds: Story = {
  args: {
    tabs: browserPanelTabFixtures,
    activeTabId: 'workflow-release',
  },
}

export const LoadingBrowser: Story = {
  args: {
    tabs: [browserLoadingTabFixture, ...browserPanelTabFixtures.slice(2, 5)],
    activeTabId: browserLoadingTabFixture.id,
  },
}

export const CrossSession: Story = {
  args: {
    tabs: browserPanelTabFixtures.slice(0, 3),
    activeTabId: 'browser-research',
  },
}

export const DiscardConfirmation: Story = {
  args: {
    tabs: browserPanelTabFixtures.slice(-3),
    activeTabId: 'plan-refine',
    discardPromptTabId: 'plan-refine',
  },
}

export const Empty: Story = {
  args: {
    tabs: [],
    activeTabId: null,
    contextUsageAvailable: false,
  },
}
