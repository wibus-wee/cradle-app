import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { CodexAccountDiagnosticsPanelView } from './codex-account-diagnostics-panel-view'

const meta = {
  title: 'Agent Management/CodexAccountDiagnosticsPanelView',
  component: CodexAccountDiagnosticsPanelView,
  args: {
    diagnostics: null,
    diagnosticsLoading: false,
    diagnosticsError: null,
    whamDiagnostics: null,
    whamLoading: false,
    resetPending: false,
    dialogOpen: true,
    resetDialogOpen: false,
    activeTab: 'usage',
    onDialogOpenChange: fn(),
    onResetDialogOpenChange: fn(),
    onActiveTabChange: fn(),
    onRefresh: fn(),
    onUseResetCredit: fn(),
    onCancelResetCredit: fn(),
    onConfirmResetCredit: fn(),
  },
} satisfies Meta<typeof CodexAccountDiagnosticsPanelView>

export default meta

type Story = StoryObj<typeof meta>

export const UsageError: Story = {
  args: {
    diagnosticsError: {
      code: 'codex_account_diagnostics_read_failed',
      message: 'token usage profile fetch timed out',
    },
  },
}

export const UsageLoading: Story = {
  args: {
    diagnosticsLoading: true,
  },
}
