import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  managedResourceFixtures,
  managedResourceTaskFixtures,
} from './fixtures/managed-resources'
import { ManagedResourcesPageView } from './managed-resources-page-view'
import { managedResourceKey } from './projection'

const meta = {
  title: 'App/Managed Resources/Download Center',
  component: ManagedResourcesPageView,
  decorators: [
    Story => (
      <main className="h-screen min-h-160 bg-muted/20 p-2 sm:p-6">
        <section className="mx-auto h-full max-w-6xl overflow-hidden border border-border bg-background shadow-sm">
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    resources: managedResourceFixtures,
    tasks: managedResourceTaskFixtures,
    activeTasks: managedResourceTaskFixtures.filter(
      task => task.status === 'downloading',
    ),
    loading: false,
    error: false,
    actionResourceKey: null,
    actionPending: false,
    actionError: false,
    onRetryResources: () => {},
    onResourceAction: () => {},
    onCancelTask: () => {},
    onRetryTask: () => {},
  },
} satisfies Meta<typeof ManagedResourcesPageView>

export default meta
type Story = StoryObj<typeof meta>

export const Library: Story = {}

export const Activity: Story = {
  args: {
    initialFace: 'activity',
  },
}

export const ResourceActionFailed: Story = {
  args: {
    actionResourceKey: managedResourceKey(managedResourceFixtures[1]),
    actionError: true,
  },
}

export const Loading: Story = {
  args: {
    resources: [],
    tasks: [],
    activeTasks: [],
    loading: true,
  },
}

export const LoadError: Story = {
  args: {
    resources: [],
    tasks: [],
    activeTasks: [],
    error: true,
  },
}

export const Empty: Story = {
  args: {
    resources: [],
    tasks: [],
    activeTasks: [],
  },
}
