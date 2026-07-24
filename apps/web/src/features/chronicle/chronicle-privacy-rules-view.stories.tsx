import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { ChroniclePrivacyRulesView } from './chronicle-privacy-rules-view'
import { chronicleConfigFixture } from './fixtures/chronicle-status'

const configuredPrivacyFixture = {
  ...chronicleConfigFixture,
  privacySensitiveAppBundleIds: [
    'com.apple.Terminal',
    'com.1password.1password',
  ],
  privacySensitiveTitlePatterns: [
    'Bank Dashboard',
    'Production secrets',
  ],
  privacySensitiveUrlPatterns: [
    'admin.example.com',
    '/billing/private',
  ],
}

const meta = {
  title: 'App/Chronicle/Privacy Rules',
  component: ChroniclePrivacyRulesView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4">
        <div className="mx-auto max-w-6xl rounded-lg border border-border bg-card px-4">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    config: configuredPrivacyFixture,
    saving: false,
    onUpdateConfig: fn(async updates => ({
      ...configuredPrivacyFixture,
      ...updates,
    })),
  },
} satisfies Meta<typeof ChroniclePrivacyRulesView>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {}

export const Empty: Story = {
  args: {
    config: {
      ...configuredPrivacyFixture,
      privacySensitiveAppBundleIds: [],
      privacySensitiveTitlePatterns: [],
      privacySensitiveUrlPatterns: [],
    },
  },
}

export const Unavailable: Story = {
  args: {
    config: null,
  },
}

export const Saving: Story = {
  args: {
    saving: true,
  },
}
