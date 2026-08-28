import type { Meta, StoryObj } from '@storybook/react-vite'

import { PersonalPluginReviewCardView } from '../personal-plugin-review-card-view'

const meta = {
  title: 'Chat/PersonalPluginReviewCardView',
  component: PersonalPluginReviewCardView,
  args: {
    title: 'Plugin ready to review',
    description: 'The agent installed a new immutable snapshot for this conversation.',
    actionLabel: 'Review and activate',
    permissionFallback: 'No permissions requested',
    activating: false,
    onActivate: () => undefined,
    plugins: [
      {
        identity: '@personal/release-notes',
        displayName: 'Release Notes',
        layers: [
          { layer: 'server', status: 'discovered' },
          { layer: 'web', status: 'discovered' },
        ],
        permissions: [
          { id: 'workspace.read', label: 'Read workspace files' },
        ],
      },
    ],
  },
  decorators: [Story => <div className="max-w-208 p-6"><Story /></div>],
} satisfies Meta<typeof PersonalPluginReviewCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Activating: Story = {
  args: { activating: true },
}
