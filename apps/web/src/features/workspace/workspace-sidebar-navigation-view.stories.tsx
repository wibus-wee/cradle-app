import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { WorkspaceSidebarNavigationView } from './workspace-sidebar-navigation-view'

const meta = {
  title: 'App/Workspace/Sidebar Navigation',
  component: WorkspaceSidebarNavigationView,
  decorators: [
    (Story, context) => (
      <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
        <section
          className={
            context.args.collapsed
              ? 'w-12 border border-sidebar-border bg-sidebar py-2 shadow-sm'
              : 'w-72 border border-sidebar-border bg-sidebar py-2 shadow-sm'
          }
        >
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    collapsed: false,
    pullRequestsActive: false,
    onNewWork: fn(),
    onNewChat: fn(),
    onSearch: fn(),
    onDiff: fn(),
    onPullRequests: fn(),
    onAutomation: fn(),
    onUsage: fn(),
    onSettings: fn(),
  },
} satisfies Meta<typeof WorkspaceSidebarNavigationView>

export default meta
type Story = StoryObj<typeof meta>

export const Expanded: Story = {}

export const PullRequestsActive: Story = {
  args: {
    pullRequestsActive: true,
  },
}

export const Collapsed: Story = {
  args: {
    collapsed: true,
  },
}
