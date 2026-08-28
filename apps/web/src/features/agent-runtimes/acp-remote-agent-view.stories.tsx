import type { Meta, StoryObj } from '@storybook/react-vite'

import type { AcpRemoteAgentViewLabels } from './acp-remote-agent-view'
import { AcpRemoteAgentView } from './acp-remote-agent-view'

const labels: AcpRemoteAgentViewLabels = {
  createTitle: 'Add remote ACP agent',
editTitle: 'Remote ACP agent',
remoteChip: 'Remote',
  name: 'Name',
namePlaceholder: 'Production ACP',
transport: 'Transport',
http: 'HTTP',
websocket: 'WebSocket',
  endpoint: 'Endpoint',
endpointPlaceholderHttp: 'https://agent.example.com/acp',
endpointPlaceholderWebsocket: 'wss://agent.example.com/acp',
  endpointDescription: 'Secure endpoints are required except on this device.',
headers: 'Request headers',
  headersDescription: 'Map header names to Secrets. Credential values stay in Secrets.',
headerName: 'Header',
  headerNamePlaceholder: 'Authorization',
secret: 'Secret',
secretPlaceholder: 'Select a Secret',
noSecrets: 'No Secrets available',
  addHeader: 'Add header',
removeHeader: 'Remove header',
duplicateHeader: 'Header names must be unique.',
  incompleteHeader: 'Choose a name and Secret for every header.',
save: 'Save',
saving: 'Saving…',
create: 'Add agent',
  creating: 'Adding…',
delete: 'Delete',
deleting: 'Deleting…',
cancel: 'Cancel',
  deleteTitle: 'Delete remote ACP agent?',
deleteDescription: 'This removes the endpoint configuration from this device.',
  deleteCancel: 'Cancel',
deleteConfirm: 'Delete',
}

const meta = {
  title: 'Agent Runtimes/AcpRemoteAgentView',
  component: AcpRemoteAgentView,
  args: {
    mode: 'edit',
    agentId: 'remote-production',
    initialDraft: {
      name: 'Production ACP',
      connectionType: 'websocket',
      endpointUrl: 'wss://agent.example.com/acp',
      headers: [{ id: 'authorization', name: 'Authorization', secretId: 'secret-api-token' }],
    },
    secrets: [{ id: 'secret-api-token', label: 'ACP production token', maskedSecret: '••••••••' }],
    isSecretsLoading: false,
    labels,
    isSaving: false,
    isDeleting: false,
    error: null,
    onSave: () => {},
    onDelete: () => {},
    onCancel: () => {},
  },
  parameters: {
    docs: { description: { component: 'Fixture-driven remote ACP endpoint editor without queries, routes, stores, or Electron dependencies.' } },
  },
} satisfies Meta<typeof AcpRemoteAgentView>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {}

export const Create: Story = {
  args: {
    mode: 'create',
    agentId: undefined,
    initialDraft: { name: '', connectionType: 'http', endpointUrl: '', headers: [] },
    onDelete: undefined,
  },
}

export const SecretsUnavailable: Story = {
  args: { secrets: [], error: 'Could not load Secrets.' },
}
