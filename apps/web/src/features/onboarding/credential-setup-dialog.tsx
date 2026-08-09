import { ArrowRightLine as ArrowRightIcon, CheckCircleLine as CheckIcon } from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getExternalProviderSourcesOptions,
  getExternalProviderSourcesRecordsOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { ProviderSetupFlow } from '~/features/agent-management/provider-setup-flow'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { GithubAppConnectionView } from '~/features/settings/github-app-connection-view'
import { useGithubAppConnectionController } from '~/features/settings/use-github-app-connection-controller'
import { cn } from '~/lib/cn'

import type { FirstRunSetupStepKey } from './credential-setup-store'
import {
  areAllFirstRunSetupStepsCompleted,
  isFirstRunSetupStepCompleted,
  resolvePendingFirstRunSetupSteps,
  useFirstRunSetupStore,
} from './credential-setup-store'
import { useOnboardingStore } from './onboarding-store'

type DialogStep = FirstRunSetupStepKey | 'done'

const CC_SWITCH_SOURCE_ID = 'cc-switch'

/**
 * First-run setup dialog keyed by step.
 *
 * Opens whenever brand onboarding is done and at least one step key is still
 * pending (not completed in the store and not environmentally satisfied).
 * Completing or skipping a step writes that key; dismiss writes all remaining
 * keys from the current session queue.
 */
export function CredentialSetupDialog() {
  const { t } = useTranslation('onboarding')
  const onboardingCompleted = useOnboardingStore(s => s.completed)
  const completedSteps = useFirstRunSetupStore(s => s.completedSteps)
  const completeStep = useFirstRunSetupStore(s => s.completeStep)
  const completeSteps = useFirstRunSetupStore(s => s.completeSteps)

  const { providerOptions, isSuccess: targetsReady } = useProviderTargets()
  const { data: externalSources = [], isSuccess: sourcesReady } = useQuery(getExternalProviderSourcesOptions())
  const { data: externalRecords = [], isSuccess: recordsReady } = useQuery(getExternalProviderSourcesRecordsOptions())
  const github = useGithubAppConnectionController()

  const hasExternalProviderData = useMemo(() => {
    const sources = externalSources as Array<{ sourceId?: string }>
    const records = externalRecords as Array<{ sourceKind?: string, sourceKey?: string }>
    return records.length > 0
      || sources.some(source => source.sourceId === CC_SWITCH_SOURCE_ID)
      || records.some(record => record.sourceKind === CC_SWITCH_SOURCE_ID || record.sourceKey === CC_SWITCH_SOURCE_ID)
  }, [externalRecords, externalSources])

  const providerSatisfied = targetsReady && (providerOptions.length > 0 || hasExternalProviderData)
  const githubSatisfied = github.isConnected
  const inventoryReady = targetsReady && sourcesReady && recordsReady && !github.loading

  const pendingSteps = useMemo(
    () => resolvePendingFirstRunSetupSteps({
      completedSteps,
      providerSatisfied,
      githubSatisfied,
    }),
    [completedSteps, githubSatisfied, providerSatisfied],
  )

  const [sessionActive, setSessionActive] = useState(false)
  const [step, setStep] = useState<DialogStep | null>(null)
  const [sessionQueue, setSessionQueue] = useState<FirstRunSetupStepKey[]>([])
  const [providerPresetId, setProviderPresetId] = useState<string | null>(null)

  useEffect(() => {
    if (!onboardingCompleted || !inventoryReady || pendingSteps.length === 0 || sessionActive) {
      return
    }
    setSessionActive(true)
    setSessionQueue(pendingSteps)
    setStep(pendingSteps[0] ?? 'done')
  }, [inventoryReady, onboardingCompleted, pendingSteps, sessionActive])

  const open = onboardingCompleted && sessionActive

  const visibleSteps: DialogStep[] = sessionQueue.length > 0 ? [...sessionQueue, 'done'] : ['done']
  const stepIndex = step ? visibleSteps.indexOf(step) : -1

  function closeSession() {
    setSessionActive(false)
    setStep(null)
    setSessionQueue([])
    setProviderPresetId(null)
  }

  function dismissRemaining() {
    const remaining = sessionQueue.filter(key => !isFirstRunSetupStepCompleted(completedSteps, key))
    if (remaining.length > 0) {
      completeSteps(remaining)
    }
    closeSession()
  }

  function advanceFrom(current: FirstRunSetupStepKey) {
    completeStep(current)
    const currentIndex = sessionQueue.indexOf(current)
    const next = currentIndex >= 0 ? sessionQueue[currentIndex + 1] : undefined
    setStep(next ?? 'done')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          dismissRemaining()
        }
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-[520px]"
        showCloseButton={false}
        data-testid="first-run-setup-dialog"
        data-setup-step={step ?? 'loading'}
      >
        <div className="px-5 pt-5 pb-3">
          <div className="mb-3 flex items-center gap-1.5">
            {Array.from({ length: Math.max(visibleSteps.length, 1) }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-150',
                  index <= stepIndex
                    ? 'bg-foreground'
                    : 'bg-muted',
                )}
              />
            ))}
          </div>
          <DialogTitle className="font-heading text-base font-semibold tracking-tight text-balance">
            {step === 'github'
              ? t('setup.github.title')
              : step === 'done'
                ? t('setup.done.title')
                : t('setup.provider.title')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-pretty">
            {step === 'github'
              ? t('setup.github.description')
              : step === 'done'
                ? t('setup.done.description')
                : t('setup.provider.description')}
          </DialogDescription>
        </div>

        <div className="max-h-[min(60vh,480px)] overflow-y-auto px-5 pb-4">
          {step === null || !inventoryReady
            ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  {t('setup.loading')}
                </p>
              )
            : null}

          {step === 'provider'
            ? (
                // Full-bleed: the flow owns its own horizontal padding and
                // pinned footer, matching the settings AddProviderDialog.
                <div className="-mx-5 -mb-4">
                  <ProviderSetupFlow
                    presetId={providerPresetId}
                    onSelectPreset={presetId => setProviderPresetId(presetId || null)}
                    onComplete={() => advanceFrom('provider')}
                    onCancel={() => advanceFrom('provider')}
                    showGalleryHeader={false}
                  />
                </div>
              )
            : null}

          {step === 'github'
            ? (
                <div className="space-y-3">
                  <GithubAppConnectionView
                    embedded
                    connection={github.connection}
                    pendingLogin={github.pendingLogin}
                    loading={github.loading}
                    connecting={github.connecting}
                    disconnecting={github.disconnecting}
                    labels={github.labels}
                    onInstall={github.onInstall}
                    onConnect={github.onConnect}
                    onContinueInBrowser={github.onContinueInBrowser}
                    onCancel={github.onCancel}
                    onDisconnect={github.onDisconnect}
                  />
                  {!github.isConnected
                    ? (
                        <p className="text-[12px] text-muted-foreground text-pretty">
                          {t('setup.github.skipHint')}
                        </p>
                      )
                    : null}
                </div>
              )
            : null}

          {step === 'done'
            ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
                    <CheckIcon className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-[13px] text-muted-foreground text-pretty">
                    {github.isConnected
                      ? t('setup.done.bodyWithGithub')
                      : t('setup.done.bodyWithoutGithub')}
                  </p>
                </div>
              )
            : null}
        </div>

        <DialogFooter variant="bare" className="justify-between border-t border-border px-4 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={dismissRemaining} className="h-7 text-xs text-muted-foreground" data-testid="first-run-skip-all">
            {t('setup.skip')}
          </Button>
          <div className="flex items-center gap-2">
            {step === 'provider'
              ? (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => advanceFrom('provider')} data-testid="first-run-provider-skip">
                    {t('setup.provider.skip')}
                  </Button>
                )
              : null}
            {step === 'github'
              ? (
                  <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => advanceFrom('github')} data-testid="first-run-github-continue">
                    {github.isConnected ? t('setup.continue') : t('setup.github.continueAnyway')}
                    <ArrowRightIcon className="size-3.5" />
                  </Button>
                )
              : null}
            {step === 'done'
              ? (
                  <Button size="sm" className="h-7 text-xs" onClick={closeSession} data-testid="first-run-finish">
                    {t('setup.finish')}
                  </Button>
                )
              : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** True when every known setup step key has been completed or skipped. */
export function useCredentialSetupDone() {
  return useFirstRunSetupStore(s => areAllFirstRunSetupStepsCompleted(s.completedSteps))
}
