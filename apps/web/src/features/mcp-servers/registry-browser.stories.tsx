import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { registryCandidates } from './fixtures/mcp-servers'
import { RegistryBrowserView } from './registry-browser'

const meta = {
  title: 'Settings/RegistryBrowserView',
  component: RegistryBrowserView,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div className="mx-auto w-full max-w-3xl">
        <Story />
      </div>
    ),
  ],
  args: {
    search: '',
    candidates: registryCandidates,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    onSearchChange: fn(),
    onRetry: fn(),
    onLoadMore: fn(),
    onInstall: fn(),
  },
} satisfies Meta<typeof RegistryBrowserView>

export default meta

type Story = StoryObj<typeof meta>

export const Populated: Story = {
  args: { hasNextPage: true },
}

export const Loading: Story = {
  args: { candidates: [], isLoading: true },
}

export const ErrorState: Story = {
  args: { candidates: [], isError: true },
}

export const Empty: Story = {
  args: { candidates: [], search: 'nonexistent' },
}
