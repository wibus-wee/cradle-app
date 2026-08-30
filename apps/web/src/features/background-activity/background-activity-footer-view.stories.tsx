import type { Meta, StoryObj } from '@storybook/react-vite'

import { BackgroundActivityFooterView } from './background-activity-footer-view'

const meta = {
  title: 'Background Activity/BackgroundActivityFooterView',
  component: BackgroundActivityFooterView,
  args: {
    labels: {
      title: 'Background activity',
      open: 'Open background activity',
      dismiss: 'OK',
      dismissAll: 'Dismiss all',
      noticeCount: count => `${count} notices`,
    },
    onDismiss: () => {},
    onDismissAll: () => {},
    onOpenAction: () => {},
  },
  decorators: [Story => <div className="flex h-9 w-[52rem] items-center bg-sidebar"><Story /></div>],
} satisfies Meta<typeof BackgroundActivityFooterView>

export default meta
type Story = StoryObj<typeof meta>

export const MultipleNotices: Story = {
  args: {
    items: [
      {
        identity: 'codex-reset-watch\u0000refresh-status\u0000watch-1',
        priority: 'normal',
        title: 'Codex reset watch',
        description: '80% chance by end of Saturday',
        actionLabel: 'View source',
        actionUrl: 'https://codex-resets.com',
        expiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      },
      {
        identity: 'release\u0000check\u0000release-1',
        priority: 'low',
        title: 'A runtime update is ready',
        description: 'Restart when your active sessions finish.',
        actionLabel: null,
        actionUrl: null,
        expiresAt: null,
        updatedAt: Date.now() - 1_000,
      },
    ],
  },
}
