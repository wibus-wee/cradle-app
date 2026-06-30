// Shared types, query keys and presentational helpers for the Integrations
// settings section. Kept free of data fetching so every view (console,
// master-detail, dialogs) can compose them without prop-drilling.
import type {
  GetConversationBridgeAdaptersResponse,
  GetConversationBridgeConnectionsByIdChannelBindingsResponse,
  GetConversationBridgeConnectionsByIdThreadsResponse,
  GetConversationBridgeConnectionsResponse,
  GetConversationBridgeDeliveryAttemptsRetryableResponse,
  GetSecretsResponse,
} from '~/api-gen/types.gen'
import { cn } from '~/lib/cn'

export type Adapter = GetConversationBridgeAdaptersResponse[number]
export type Connection = GetConversationBridgeConnectionsResponse[number]
export type ChannelBinding = GetConversationBridgeConnectionsByIdChannelBindingsResponse[number]
export type ThreadBinding = GetConversationBridgeConnectionsByIdThreadsResponse[number]
export type DeliveryAttempt = GetConversationBridgeDeliveryAttemptsRetryableResponse[number]
export type Secret = GetSecretsResponse[number]

export type HealthStatus = 'unknown' | 'starting' | 'running' | 'stopped' | 'error'

export const queryKeys = {
  adapters: ['conversation-bridge', 'adapters'] as const,
  connections: ['conversation-bridge', 'connections'] as const,
  connection: (id: string) => ['conversation-bridge', 'connections', id] as const,
  channelBindings: (id: string) => ['conversation-bridge', 'connections', id, 'channel-bindings'] as const,
  runtimeTargets: ['conversation-bridge', 'runtime-targets'] as const,
  threads: (id: string) => ['conversation-bridge', 'connections', id, 'threads'] as const,
  retryableDeliveries: ['conversation-bridge', 'delivery-attempts', 'retryable'] as const,
  secrets: ['secrets'] as const,
}

const healthDotClasses: Record<HealthStatus, string> = {
  unknown: 'bg-muted-foreground/40',
  starting: 'bg-warning',
  running: 'bg-success',
  stopped: 'bg-muted-foreground/40',
  error: 'bg-destructive',
}

const healthDotSizes = {
  sm: 'size-1.5',
  md: 'size-2',
  lg: 'size-2.5',
}

/**
 * Health status indicator. A flat dot — no glow, no shadow — carrying the
 * semantic status colour. Pulses subtly only while running.
 */
export function StatusDot({
  status,
  pulse,
  size = 'md',
}: {
  status: HealthStatus
  pulse?: boolean
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span className="relative flex shrink-0 items-center justify-center" aria-hidden="true">
      {pulse && status === 'running' && (
        <span
          className={cn(
            'absolute inline-flex animate-ping rounded-full opacity-40',
            healthDotClasses[status],
            healthDotSizes[size === 'sm' ? 'md' : size === 'md' ? 'lg' : 'lg'],
          )}
        />
      )}
      <span className={cn('relative inline-flex rounded-full', healthDotClasses[status], healthDotSizes[size])} />
    </span>
  )
}

/**
 * Platform glyph tile. Flat muted surface with a mono initial — no gradient,
 * no shadow (Cradle design system: surface texture, not elevation; accent is
 * semantic, never decorative). The platform badge + health dot carry identity.
 */
export function PlatformGlyph({
  platform,
  label,
  size = 'md',
}: {
  platform: string
  label?: string
  size?: 'sm' | 'md'
}) {
  const initial = (label?.[0] ?? platform[0] ?? '?').toUpperCase()
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-muted font-mono font-semibold text-foreground select-none',
        size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-[13px]',
      )}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}

// Time ago helper
export function timeAgo(timestamp: number | null): string | null {
  if (!timestamp) { return null }
  const diff = Math.floor(Date.now() / 1000) - timestamp
  if (diff < 60) { return 'just now' }
  if (diff < 3600) { return `${Math.floor(diff / 60)}m ago` }
  if (diff < 86400) { return `${Math.floor(diff / 3600)}h ago` }
  if (diff < 2592000) { return `${Math.floor(diff / 86400)}d ago` }
  return new Date(timestamp * 1000).toLocaleDateString()
}

export function formatTimestamp(timestamp: number | null): string | null {
  if (!timestamp) { return null }
  return new Date(timestamp * 1000).toLocaleString()
}

// Health status label. `t` is typed loosely to stay compatible with i18next's
// overloaded TFunction without forcing every caller to narrow it — matches the
// prior local implementation.
// eslint-disable-next-line ts/no-explicit-any
export function healthStatusLabel(status: HealthStatus, t: any): string {
  switch (status) {
    case 'unknown': return t('integrations.connection.healthUnknown')
    case 'starting': return t('integrations.connection.healthStarting')
    case 'running': return t('integrations.connection.healthRunning')
    case 'stopped': return t('integrations.connection.healthStopped')
    case 'error': return t('integrations.connection.healthError')
    default: return status
  }
}
