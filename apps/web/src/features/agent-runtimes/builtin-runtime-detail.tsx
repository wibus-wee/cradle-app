import {
  CheckLine as CheckIcon,
  SubtractLine as MinusIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { RuntimeIcon } from '~/components/common/provider-icons'
import type { Agent } from '~/features/agent-runtime/use-agents'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/use-runtime-catalog'
import { cn } from '~/lib/cn'

import { ExperimentalChip } from './runtime-list-pane'
import { CreateAgentButton, UsedBySection } from './used-by-section'

type RuntimesKey = keyof typeof import('~/locales/default').default.runtimes

type CapabilityTone = 'positive' | 'partial' | 'unsupported'

interface CapabilityRow {
  labelKey: RuntimesKey
  valueKey: RuntimesKey
  tone: CapabilityTone
}

function booleanCapability(labelKey: RuntimesKey, supported: boolean): CapabilityRow {
  return {
    labelKey,
    valueKey: supported ? 'capability.value.supported' : 'capability.value.unsupported',
    tone: supported ? 'positive' : 'unsupported',
  }
}

function buildCapabilityRows(capabilities: NonNullable<RuntimeCatalogItem['capabilities']>): CapabilityRow[] {
  const steer: CapabilityRow = capabilities.steer === 'native'
    ? { labelKey: 'capability.steer', valueKey: 'capability.value.native', tone: 'positive' }
    : capabilities.steer === 'queue-fallback'
      ? { labelKey: 'capability.steer', valueKey: 'capability.value.queueFallback', tone: 'partial' }
      : { labelKey: 'capability.steer', valueKey: 'capability.value.unsupported', tone: 'unsupported' }

  const sessionModelSwitch: CapabilityRow = capabilities.sessionModelSwitch === 'in-session'
    ? { labelKey: 'capability.sessionModelSwitch', valueKey: 'capability.value.inSession', tone: 'positive' }
    : capabilities.sessionModelSwitch === 'restart-session'
      ? { labelKey: 'capability.sessionModelSwitch', valueKey: 'capability.value.restartSession', tone: 'partial' }
      : { labelKey: 'capability.sessionModelSwitch', valueKey: 'capability.value.unsupported', tone: 'unsupported' }

  return [
    steer,
    sessionModelSwitch,
    booleanCapability('capability.supportsShellExecution', capabilities.supportsShellExecution),
    booleanCapability('capability.supportsLastTurnRollback', capabilities.supportsLastTurnRollback),
    booleanCapability('capability.supportsRuntimeSettings', capabilities.supportsRuntimeSettings),
    booleanCapability('capability.supportsTitleGeneration', capabilities.supportsTitleGeneration),
  ]
}

function CapabilityValueIcon({ tone }: { tone: CapabilityTone }) {
  if (tone === 'partial') {
    return <span aria-hidden="true" className="w-3.5 text-center text-[13px] leading-none">~</span>
  }
  if (tone === 'positive') {
    return <CheckIcon className="size-3.5" aria-hidden="true" />
  }
  return <MinusIcon className="size-3.5" aria-hidden="true" />
}

const DEGRADATION_STATUS_CHIP_CLASSES: Record<string, string> = {
  unsupported: 'bg-fill text-text-tertiary',
  partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  experimental: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

const DEGRADATION_STATUS_LABEL_KEYS: Record<string, RuntimesKey> = {
  unsupported: 'degradation.status.unsupported',
  partial: 'degradation.status.partial',
  experimental: 'degradation.status.experimental',
}

const DEGRADATION_CAPABILITY_KEYS: Record<string, RuntimesKey> = {
  runtime: 'degradation.capability.runtime',
  lastTurnRollback: 'degradation.capability.lastTurnRollback',
  runtimeSettings: 'degradation.capability.runtimeSettings',
  steer: 'degradation.capability.steer',
}

export function BuiltinRuntimeDetail({
  runtime,
  usedByAgents,
}: {
  runtime: RuntimeCatalogItem
  usedByAgents: Agent[]
}) {
  const { t } = useTranslation('runtimes')

  const providerBinding = runtime.providerBinding ?? 'required'
  const providerLineKey = providerBinding === 'none'
    ? 'builtin.provider.none'
    : providerBinding === 'runtime-owned'
      ? 'builtin.provider.runtimeOwned'
      : 'builtin.provider.required'

  const capabilityRows = runtime.capabilities ? buildCapabilityRows(runtime.capabilities) : null
  const degradations = runtime.degradations ?? []

  return (
    <div className="flex flex-col gap-5 p-6" data-testid={`runtime-detail-${runtime.runtimeKind}`}>
      {/* Header */}
      <header className="flex items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-fill">
          <RuntimeIcon icon={runtime.icon} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-foreground">{runtime.label}</h2>
            <span className="inline-flex shrink-0 items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
              {t('chip.builtin')}
            </span>
            {runtime.stability === 'experimental' && <ExperimentalChip />}
          </div>
          {runtime.description && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground text-pretty">
              {runtime.description}
            </p>
          )}
        </div>
      </header>

      {/* Provider relationship */}
      <p className="text-[13px] text-muted-foreground">{t(providerLineKey)}</p>

      {/* Capabilities */}
      {capabilityRows && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-foreground">{t('builtin.capabilities.title')}</h3>
          <dl className="flex flex-col">
            {capabilityRows.map(row => (
              <div key={row.labelKey} className="flex items-center justify-between gap-4 py-1.5">
                <dt className="text-[13px] text-muted-foreground">{t(row.labelKey)}</dt>
                <dd
                  className={cn(
                    'flex items-center gap-1.5 text-[12px]',
                    row.tone === 'unsupported' ? 'text-text-tertiary' : 'text-foreground',
                  )}
                >
                  <CapabilityValueIcon tone={row.tone} />
                  {t(row.valueKey)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Degradations */}
      {degradations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-foreground">{t('builtin.degradations.title')}</h3>
          <div className="flex flex-col gap-2.5">
            {degradations.map((degradation) => {
              const capabilityLabelKey = DEGRADATION_CAPABILITY_KEYS[degradation.capability]
              return (
                <div key={`${degradation.capability}:${degradation.reason}`} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-foreground">
                      {capabilityLabelKey ? t(capabilityLabelKey) : degradation.capability}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        DEGRADATION_STATUS_CHIP_CLASSES[degradation.status] ?? 'bg-fill text-text-tertiary',
                      )}
                    >
                      {t(DEGRADATION_STATUS_LABEL_KEYS[degradation.status] ?? 'degradation.status.unsupported')}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{degradation.reason}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Used by + create */}
      <UsedBySection agents={usedByAgents} />
      <div>
        <CreateAgentButton runtimeKind={runtime.runtimeKind} />
      </div>
    </div>
  )
}
