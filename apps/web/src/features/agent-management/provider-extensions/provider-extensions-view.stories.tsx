import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { providerExtensionFixtures } from './fixtures'
import { ProviderExtensionsView } from './provider-extensions-view'

const meta = {
  title: 'Agent Management/ProviderExtensionsView',
  component: ProviderExtensionsView,
  decorators: [
    Story => (
      <div className="w-[520px] bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    extensions: [providerExtensionFixtures.disabled],
    onEnabledChange: fn(),
  },
} satisfies Meta<typeof ProviderExtensionsView>

export default meta
type Story = StoryObj<typeof meta>

export const Disabled: Story = {}
export const Enabling: Story = { args: { extensions: [providerExtensionFixtures.enabling] } }
export const Enabled: Story = { args: { extensions: [providerExtensionFixtures.enabled] } }
export const Suspended: Story = { args: { extensions: [providerExtensionFixtures.suspended] } }
export const Error: Story = { args: { extensions: [providerExtensionFixtures.error] } }
export const Inapplicable: Story = { args: { extensions: [providerExtensionFixtures.inapplicable] } }
