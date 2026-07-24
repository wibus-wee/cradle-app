import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChroniclePrivacyRuleTextareaView } from './chronicle-privacy-rule-textarea-view'

const meta = {
  title: 'App/Chronicle/Privacy Rule Field',
  component: ChroniclePrivacyRuleTextareaView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-md">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    label: 'App bundle id',
    placeholder: 'com.apple.Terminal',
    value: 'com.apple.Terminal\ncom.1password.1password',
    disabled: false,
    onChange: fn(),
  },
} satisfies Meta<typeof ChroniclePrivacyRuleTextareaView>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Empty: Story = {
  args: {
    value: '',
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}
