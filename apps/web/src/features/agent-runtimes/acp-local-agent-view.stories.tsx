import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { AcpLocalAgentViewLabels } from './acp-local-agent-view'
import { AcpLocalAgentView } from './acp-local-agent-view'

const labels: AcpLocalAgentViewLabels = {
  createTitle: 'Add local ACP agent',
  editTitle: 'Local ACP agent',
  localChip: 'Local',
  name: 'Name',
  namePlaceholder: 'My ACP agent',
  launchMethod: 'Launch method',
  launchMethodCommand: 'Command',
  launchMethodNpx: 'npx',
  launchMethodUvx: 'uvx',
  command: 'Command',
  packageName: 'Package',
  commandPlaceholder: '/usr/local/bin/my-acp-agent',
  npxPlaceholder: '@scope/my-acp-agent',
  uvxPlaceholder: 'my-acp-agent',
  arguments: 'Arguments',
  argumentsDescription: 'Enter one argument per line.',
  argumentsPlaceholder: '--stdio\n--log-level=info',
  environment: 'Environment',
  environmentDescription: 'Enter one non-secret KEY=VALUE pair per line. Configure credentials after adding the agent.',
  environmentPlaceholder: 'LOG_LEVEL=info',
  environmentInvalid: 'Invalid environment lines: {{lines}}',
  save: 'Save',
  saving: 'Saving…',
  create: 'Add agent',
  creating: 'Adding…',
  delete: 'Delete',
  deleting: 'Deleting…',
  deleteTitle: 'Delete local ACP agent?',
  deleteDescription: 'This removes the launch configuration from this device.',
  deleteCancel: 'Cancel',
  deleteConfirm: 'Delete',
  cancel: 'Cancel',
}

const meta = {
  title: 'Agent Runtimes/AcpLocalAgentView',
  component: AcpLocalAgentView,
  decorators: [Story => <div className="h-[720px] w-[38rem] overflow-y-auto bg-background"><Story /></div>],
  parameters: { layout: 'centered' },
  args: {
    mode: 'create',
    initialDraft: {
      name: '',
      distributionType: 'command',
      command: '',
      argumentsText: '',
      environmentText: '',
    },
    labels,
    isSaving: false,
    isDeleting: false,
    error: null,
    onSave: fn(),
    onDelete: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof AcpLocalAgentView>

export default meta

type Story = StoryObj<typeof meta>

export const Create: Story = {}

export const EditNpx: Story = {
  args: {
    mode: 'edit',
    agentId: 'local-claude-code',
    initialDraft: {
      name: 'Claude Code ACP',
      distributionType: 'npx',
      command: '@zed-industries/claude-code-acp',
      argumentsText: '--stdio',
      environmentText: 'LOG_LEVEL=info',
    },
  },
}

export const SaveError: Story = {
  args: {
    mode: 'edit',
    agentId: 'local-broken-agent',
    initialDraft: {
      name: 'Broken ACP agent',
      distributionType: 'command',
      command: '/missing/acp-agent',
      argumentsText: '',
      environmentText: '',
    },
    error: 'The launch command could not be saved.',
  },
}
