import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { ServerConnectionStatus } from './server-connection-recovery-view'
import { ServerConnectionRecoveryView } from './server-connection-recovery-view'

const labels = {
  title: 'Cannot reach Cradle Server',
  hostedDescription: 'Choose a Cradle Server that this device can reach, then reconnect.',
  desktopDescription: 'The local server did not finish starting. Retry the connection or restart Cradle.',
  endpointLabel: 'Backend API URL',
  endpointHint: 'Use an HTTPS address reachable from this device.',
  invalidEndpoint: 'Enter a valid http:// or https:// URL.',
  retry: 'Retry',
  retrying: 'Retrying...',
  test: 'Test connection',
  testing: 'Testing...',
  connect: 'Connect',
  useDefault: 'Use default',
  securityNote: 'Only connect to a server you trust. Cradle sends app requests to this address.',
  details: 'Technical details',
}

function RecoveryStory({ desktop = false }: { desktop?: boolean }) {
  const [draftEndpoint, setDraftEndpoint] = useState('https://cradle.example.ts.net')
  const [status, setStatus] = useState<ServerConnectionStatus>({ kind: 'idle' })

  return (
    <div className="h-screen">
      <ServerConnectionRecoveryView
        labels={labels}
        endpoint="http://127.0.0.1:21423"
        draftEndpoint={draftEndpoint}
        canConfigureEndpoint={!desktop}
        hasCustomEndpoint={!desktop}
        validationError={false}
        retrying={false}
        status={status}
        errorDetail="Could not reach Cradle Server at http://127.0.0.1:21423."
        onDraftEndpointChange={setDraftEndpoint}
        onRetry={() => setStatus({ kind: 'error', message: 'The server is still unavailable.' })}
        onTestConnection={() => setStatus({ kind: 'success', message: 'Connection succeeded.' })}
        onConnect={() => setStatus({ kind: 'checking' })}
        onUseDefault={() => setDraftEndpoint('http://127.0.0.1:21423')}
      />
    </div>
  )
}

const meta = {
  title: 'System/ServerConnectionRecoveryView',
  component: RecoveryStory,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RecoveryStory>

export default meta
type Story = StoryObj<typeof meta>

export const HostedWeb: Story = {}
export const Desktop: Story = { args: { desktop: true } }
