import { ArrowRightLine as ArrowRightIcon, ShuffleLine as ShuffleIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getExternalProviderSourcesOptions,
  getExternalProviderSourcesRecordsOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { ProviderIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { toastManager } from '~/components/ui/toast'
import { PROVIDER_PRESETS } from '~/features/agent-management/provider-templates'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { useCredentialSetupStore } from '~/features/onboarding/credential-setup-store'
import { useOnboardingStore } from '~/features/onboarding/onboarding-store'
import { cn } from '~/lib/cn'
import { openSettingsSection } from '~/navigation/navigation-commands'

const CC_SWITCH_SOURCE_ID = 'cc-switch'

interface Row {
  key: string
  kind: 'cc-switch' | 'preset'
  presetId?: string
  name: string
  description: string
  ready?: boolean
  onSelect: () => void
}

/**
 * First-run credential setup dialog.
 *
 * Surfaced after onboarding completes. Lets the user either jump into the
 * Providers settings to configure an API key, adopt their existing cc-switch
 * setup (Cradle reads it directly — no import needed), or skip. Once the user
 * acts (or once we detect existing providers), the gate store is marked
 * complete and the dialog stops appearing.
 *
 * Mount once near the app root; it manages its own visibility.
 */
export function CredentialSetupDialog() {
  const { t } = useTranslation('onboarding')
  const onboardingCompleted = useOnboardingStore(s => s.completed)
  const setupCompleted = useCredentialSetupStore(s => s.completed)
  const complete = useCredentialSetupStore(s => s.complete)
  const skip = useCredentialSetupStore(s => s.skip)

  const { providerOptions, isSuccess: targetsReady } = useProviderTargets()

  const { data: externalSources = [] } = useQuery(getExternalProviderSourcesOptions())
  const { data: externalRecords = [] } = useQuery(getExternalProviderSourcesRecordsOptions())

  const ccSwitchDetected = useMemo(
    () =>
      (externalSources as Array<{ sourceId?: string }>).some(
        source => source.sourceId === CC_SWITCH_SOURCE_ID,
      )
      || (externalRecords as Array<{ sourceKind?: string, sourceKey?: string }>).some(
        record => record.sourceKind === CC_SWITCH_SOURCE_ID,
      ),
    [externalSources, externalRecords],
  )

  // Already configured? Silently mark complete so we never nag returning users.
  useEffect(() => {
    // return
    if (!setupCompleted && targetsReady && providerOptions.length > 0) {
      complete()
    }
  }, [setupCompleted, targetsReady, providerOptions.length, complete])

  const open = onboardingCompleted && !setupCompleted
  // const open = true
  const [busy] = useState(false)

  function handleConfigurePreset() {
    complete()
    openSettingsSection('providers')
    toastManager.add({
      type: 'success',
      title: t('credentials.toast.opening.title'),
      description: t('credentials.toast.opening.description'),
    })
  }

  function handleUseCcSwitch() {
    complete()
    toastManager.add({
      type: 'success',
      title: t('credentials.toast.ccSwitch.title'),
      description: t('credentials.toast.ccSwitch.description'),
    })
  }

  function handleSkip() {
    skip()
  }

  const rows: Row[] = [
    ...(ccSwitchDetected
      ? [{
          key: 'cc-switch',
          kind: 'cc-switch' as const,
          name: 'CC-Switch',
          description: t('credentials.ccSwitch.description'),
          ready: true,
          onSelect: handleUseCcSwitch,
        }]
      : []),
    ...PROVIDER_PRESETS.map(preset => ({
      key: preset.id,
      kind: 'preset' as const,
      presetId: preset.id,
      name: preset.name,
      description: t(`credentials.providers.${preset.id}.tagline`, preset.tagline),
      onSelect: handleConfigurePreset,
    })),
  ]

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { handleSkip() } }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[420px]" showCloseButton={false}>
        {/* Header */}
        <div className="px-5 pt-5 pb-4">
          <DialogTitle className="font-heading text-base font-semibold tracking-tight" style={{ textWrap: 'balance' }}>
            {t('credentials.welcomeTitle')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px]" style={{ textWrap: 'pretty' }}>
            {t('credentials.description')}
          </DialogDescription>
        </div>

        {/* Unified list — one hairline-bordered surface, divide-y rows. Vercel-style. */}
        <div className="px-2.5 pb-2.5">
          <div className="overflow-hidden rounded-lg border border-border divide-y divide-border">
            {rows.map(row => (
              <button
                key={row.key}
                type="button"
                onClick={row.onSelect}
                className={cn(
                  'group flex w-full items-center gap-3 px-3 py-2.5 text-left',
                  'transition-colors duration-150 hover:bg-muted/60 active:bg-muted',
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  {row.kind === 'cc-switch'
                    ? <ShuffleIcon className="size-4" />
                    : <ProviderIcon presetId={row.presetId!} className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-tight">{row.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{row.description}</span>
                </span>

                {row.ready && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t('credentials.ready')}
                    </span>
                  </span>
                )}

                <ArrowRightIcon
                  className={cn(
                    'size-4 shrink-0 transition-colors duration-150',
                    'text-muted-foreground/60 group-hover:text-foreground',
                  )}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Footer — divider stays a hairline border (layout separation, not depth) */}
        <DialogFooter variant="bare" className="justify-between border-t border-border px-4 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={handleSkip} className="h-7 text-xs text-muted-foreground">
            {t('credentials.skip')}
          </Button>
          <Button
            variant="link"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={() => openSettingsSection('providers')}
            disabled={busy}
          >
            {t('credentials.openSettings')}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Convenience for parents that want to render a "you're all set" affordance after setup. */
export function useCredentialSetupDone() {
  return useCredentialSetupStore(s => s.completed && !s.skipped)
}
