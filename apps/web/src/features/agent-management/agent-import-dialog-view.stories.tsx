import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { AgentImportDialogView } from './agent-import-dialog-view'
import { agentImportPreviewFixture } from './fixtures/agents'

const meta = {
  title: 'Agent Management/AgentImportDialogView',
  component: AgentImportDialogView,
  args: {
    open: true,
    preview: agentImportPreviewFixture,
    selectedIds: new Set(['candidate-codex']),
    busy: false,
    error: null,
    onOpenChange: fn(),
    onToggleCandidate: fn(),
    onImport: fn(),
  },
} satisfies Meta<typeof AgentImportDialogView>

export default meta

type Story = StoryObj<typeof meta>

export const Candidates: Story = {}

export const Scanning: Story = {
  args: {
    preview: null,
    selectedIds: new Set(),
  },
}

export const Empty: Story = {
  args: {
    preview: {
      candidates: [],
      sourceRefreshes: [],
    },
    selectedIds: new Set(),
  },
}

export const Error: Story = {
  args: {
    error: 'Unable to read the local Codex configuration.',
  },
}

export const Importing: Story = {
  args: {
    busy: true,
  },
}
