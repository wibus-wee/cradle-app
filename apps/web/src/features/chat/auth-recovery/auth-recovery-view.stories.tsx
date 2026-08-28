import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '~/components/ui/button'

import { AuthRecoveryView } from './auth-recovery-view'

const meta = {
  title: 'Chat/Auth Recovery/AuthRecoveryView',
  component: AuthRecoveryView,
  args: {
    labels: {
      title: 'Authentication required',
      description: 'Configure authentication, then retry the message that failed.',
      retry: 'Retry message',
      retrying: 'Retrying…',
      dismiss: 'Dismiss',
      dismissing: 'Dismissing…',
    },
    configuration: (
      <div className="border-t border-border/60 pt-4">
        <p className="text-[12px] text-muted-foreground">ACP authentication form fixture</p>
        <Button size="sm" variant="outline" className="mt-3">Configure</Button>
      </div>
    ),
    isRetrying: false,
    isDismissing: false,
    onRetry: () => {},
    onDismiss: () => {},
  },
  parameters: {
    docs: { description: { component: 'Fixture-driven authentication recovery surface with no query, runtime, or session dependencies.' } },
  },
} satisfies Meta<typeof AuthRecoveryView>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = {}
export const RetryFailed: Story = { args: { error: 'Authentication is still required.' } }
export const Retrying: Story = { args: { isRetrying: true } }
