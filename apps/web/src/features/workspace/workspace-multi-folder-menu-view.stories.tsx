import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { workspaceFixtures } from './fixtures/workspace-sidebar'
import { WorkspaceMultiFolderMenuView } from './workspace-multi-folder-menu-view'

const meta = {
  title: 'App/Workspace/Multi-folder Menu',
  component: WorkspaceMultiFolderMenuView,
  args: {
    candidates: [
      workspaceFixtures.local,
      {
        ...workspaceFixtures.local,
        id: 'workspace-frontend',
        name: 'frontend',
        identifier: 'FE',
        locator: {
          ...workspaceFixtures.local.locator,
          path: '/Users/demo/frontend',
        },
      },
      {
        ...workspaceFixtures.local,
        id: 'workspace-backend',
        name: 'backend',
        identifier: 'BE',
        locator: {
          ...workspaceFixtures.local.locator,
          path: '/Users/demo/backend',
        },
      },
    ],
    creating: false,
    onCommit: fn(async () => {}),
  },
  decorators: [
    Story => (
      <div className="w-72 rounded-lg border bg-popover p-0 shadow-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkspaceMultiFolderMenuView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Creating: Story = {
  args: {
    creating: true,
  },
}

export const NeedMoreProjects: Story = {
  args: {
    candidates: [workspaceFixtures.local],
  },
}
