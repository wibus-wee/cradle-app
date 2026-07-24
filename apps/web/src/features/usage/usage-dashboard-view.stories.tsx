import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  emptyUsageDashboardFixture,
  populatedUsageDashboardFixture,
} from './fixtures/usage-dashboard'
import { UsageDashboardView } from './usage-dashboard-view'

const meta = {
  title: 'Usage/UsageDashboardView',
  component: UsageDashboardView,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof UsageDashboardView>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  args: populatedUsageDashboardFixture,
}

export const Empty: Story = {
  args: emptyUsageDashboardFixture,
}

export const Loading: Story = {
  args: {
    ...emptyUsageDashboardFixture,
    summary: null,
    stats: null,
    usageReady: false,
  },
}

export const Dark: Story = {
  args: {
    ...populatedUsageDashboardFixture,
    themeMode: 'dark',
  },
  globals: {
    theme: 'dark',
  },
}
