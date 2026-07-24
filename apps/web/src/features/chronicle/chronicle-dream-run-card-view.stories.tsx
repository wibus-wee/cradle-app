import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChronicleDreamRunCardView } from './chronicle-dream-run-card-view'
import { chronicleDreamRunFixtures } from './fixtures/chronicle-dream-runs'

const meta = {
  title: 'App/Chronicle/Dream Run Card',
  component: ChronicleDreamRunCardView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-xl">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    run: chronicleDreamRunFixtures[0],
  },
} satisfies Meta<typeof ChronicleDreamRunCardView>

export default meta
type Story = StoryObj<typeof meta>

export const Completed: Story = {}

export const Running: Story = {
  args: {
    run: chronicleDreamRunFixtures[1],
  },
}

export const Failed: Story = {
  args: {
    run: chronicleDreamRunFixtures[2],
  },
}
