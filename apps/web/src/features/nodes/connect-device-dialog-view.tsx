import {
  ArrowRightLine as ArrowRightIcon,
  CheckLine as CheckIcon,
  ComputerLine as ComputerIcon,
  CopyLine as CopyIcon,
  LinkLine as LinkIcon,
  LoadingLine,
} from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'

import { CancelPendingEnrollmentDialog } from './cancel-pending-enrollment-dialog'

export interface ConnectDeviceDialogViewProps {
  open: boolean
  /** Whether this device already belongs to a Fabric. */
  fabricExists: boolean
  managedRelay: { relayUrl: string, accessMode: 'local' | 'network' | 'external' } | null
  busy: boolean
  /**
   * This Fabric's network code (`{ relayUrl, fabricId }`, compact-encoded).
   * Shown on linked devices so a new computer can join. Null without a Fabric.
   */
  networkCode: string | null
  /** Compact invite code generated on this device (join path), once available. */
  inviteCode: string | null
  /** True while waiting for the owner to approve this device. */
  awaitingApproval: boolean
  cancellingEnrollment: boolean
  onOpenChange: (open: boolean) => void
  /** Create the network on this device (first-computer path). */
  onStart: () => void
  /** Enroll this device from a pasted network code; produces `inviteCode`. */
  onGetCode: (networkCode: string, displayName: string) => void
  /** Approve another device's pasted invite code (owner path). */
  onSubmitCode: (code: string) => void
  onCancelEnrollment: () => void
}

const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]'

type Step = 'choose' | 'join' | 'add' | 'code'

function ChoiceCard({
  icon,
  title,
  description,
  onClick,
  testId,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-border p-3.5 text-left',
        'transition-all duration-150',
        EASE,
        'hover:border-foreground/20 hover:bg-accent/50 active:scale-[0.99]',
      )}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[12px] leading-snug text-muted-foreground">{description}</span>
      </span>
      <ArrowRightIcon
        className={cn(
          'mt-1 size-4 shrink-0 text-muted-foreground/40',
          'transition-all duration-150',
          EASE,
          'group-hover:translate-x-0.5 group-hover:text-muted-foreground',
        )}
        aria-hidden
      />
    </button>
  )
}

function CodeBox({ code, testId }: { code: string, testId: string }) {
  const { t } = useTranslation('nodes')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    }
    catch {
      // Clipboard unavailable; the code stays selectable in the box.
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code
        className="min-w-0 flex-1 select-all truncate rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[12px]"
        data-testid={testId}
      >
        {code}
      </code>
      <Button
        type="button"
        variant="outline"
        onClick={() => void copy()}
        className={cn('shrink-0 transition-transform duration-120 active:scale-[0.97]', EASE)}
        data-testid={`${testId}-copy`}
      >
        <span className="relative flex size-3.5 items-center justify-center">
          <CopyIcon
            className={cn(
              'absolute size-3.5 transition-all duration-150',
              copied ? 'scale-50 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0',
            )}
            aria-hidden
          />
          <CheckIcon
            className={cn(
              'absolute size-3.5 text-green-500 transition-all duration-150',
              copied ? 'scale-100 opacity-100 blur-0' : 'scale-50 opacity-0 blur-[2px]',
            )}
            aria-hidden
          />
        </span>
        {copied ? t('action.copied') : t('action.copy')}
      </Button>
    </div>
  )
}

export function ConnectDeviceDialogView({
  open,
  fabricExists,
  managedRelay,
  busy,
  networkCode,
  inviteCode,
  awaitingApproval,
  cancellingEnrollment,
  onOpenChange,
  onStart,
  onGetCode,
  onSubmitCode,
  onCancelEnrollment,
}: ConnectDeviceDialogViewProps) {
  const { t } = useTranslation('nodes')
  const [step, setStep] = useState<Step>(awaitingApproval ? 'code' : fabricExists ? 'add' : 'choose')
  const [code, setCode] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)

  // Progress the flow when the outside world answers: a created network moves
  // us to "add a computer"; a generated invitation moves us to the code step.
  useEffect(() => {
    if (fabricExists && (step === 'choose' || step === 'join')) {
      setStep('add')
      setCode('')
    }
  }, [fabricExists, step])
  useEffect(() => {
    if (awaitingApproval) {
      setStep('code')
    }
  }, [awaitingApproval])

  useEffect(() => {
    if (!open) {
      setStep(awaitingApproval ? 'code' : fabricExists ? 'add' : 'choose')
      setCode('')
    }
  }, [open, fabricExists, awaitingApproval])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('connect.title')}</DialogTitle>
          <DialogDescription>{t('connect.subtitle')}</DialogDescription>
        </DialogHeader>

        {step === 'choose' && (
          <div className="flex min-w-0 flex-col gap-2.5">
            <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                  <ComputerIcon className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13px] font-medium">{t('connect.start.title')}</span>
                  <span className="text-[12px] leading-snug text-muted-foreground">
                    {t('connect.start.description')}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-[12px]">
                <span className="font-medium">{t('connect.start.relayLabel')}</span>
                {managedRelay
                  ? (
                      <>
                        <code className="truncate font-mono text-muted-foreground" title={managedRelay.relayUrl}>
                          {managedRelay.relayUrl}
                        </code>
                        <span className="text-muted-foreground">
                          {t(
                            managedRelay.accessMode === 'network'
                              ? 'connect.start.networkHint'
                              : managedRelay.accessMode === 'external'
                                ? 'connect.start.externalHint'
                                : 'connect.start.localHint',
                          )}
                        </span>
                      </>
                    )
                  : <span className="text-muted-foreground">{t('connect.start.relayUnavailable')}</span>}
              </div>
              <Button
                type="button"
                disabled={busy || !managedRelay}
                onClick={onStart}
                className={cn('transition-transform duration-120 active:scale-[0.98]', EASE)}
                data-testid="connect-start"
              >
                {busy && <LoadingLine className="size-3.5 animate-spin" aria-hidden />}
                {t('connect.start.action')}
              </Button>
            </div>

            <ChoiceCard
              icon={<LinkIcon className="size-4" aria-hidden />}
              title={t('connect.join.title')}
              description={t('connect.join.description')}
              onClick={() => setStep('join')}
              testId="connect-join"
            />
          </div>
        )}

        {step === 'join' && (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-[12px] leading-snug text-muted-foreground">
              {t('connect.join.hint')}
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={code}
                placeholder={t('connect.join.placeholder')}
                autoFocus
                autoComplete="off"
                className="flex-1"
                onChange={event => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && code.trim()) {
                    onGetCode(code.trim(), '')
                  }
                }}
                data-testid="connect-network-code-input"
              />
              <Button
                type="button"
                disabled={busy || !code.trim()}
                onClick={() => onGetCode(code.trim(), '')}
                className={cn('shrink-0 transition-transform duration-120 active:scale-[0.97]', EASE)}
                data-testid="connect-join-submit"
              >
                {busy && <LoadingLine className="size-3.5 animate-spin" aria-hidden />}
                {t('connect.join.action')}
              </Button>
            </div>
          </div>
        )}

        {step === 'add' && (
          <div className="flex min-w-0 flex-col gap-4">
            {networkCode && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium">{t('connect.add.myCode')}</span>
                <CodeBox code={networkCode} testId="connect-network-code" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium">{t('connect.add.title')}</span>
              <p className="text-[12px] leading-snug text-muted-foreground">
                {t('connect.add.hint')}
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <Input
                  value={code}
                  placeholder={t('connect.add.placeholder')}
                  autoFocus
                  autoComplete="off"
                  className="flex-1"
                  onChange={event => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && code.trim()) {
                      onSubmitCode(code.trim())
                    }
                  }}
                  data-testid="connect-code-input"
                />
                <Button
                  type="button"
                  disabled={busy || !code.trim()}
                  onClick={() => onSubmitCode(code.trim())}
                  className={cn('shrink-0 transition-transform duration-120 active:scale-[0.97]', EASE)}
                >
                  {busy && <LoadingLine className="size-3.5 animate-spin" aria-hidden />}
                  {t('connect.add.submit')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'code' && inviteCode && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium">{t('connect.code.title')}</span>
              <p className="text-[12px] leading-snug text-muted-foreground">
                {t('connect.code.hint')}
              </p>
            </div>
            <CodeBox code={inviteCode} testId="connect-invite-code" />
            {awaitingApproval && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-pretty text-[12px] text-muted-foreground">
                  <LoadingLine className="size-3.5 animate-spin" aria-hidden />
                  {t('connect.code.waiting')}
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={cancellingEnrollment}
                  onClick={() => setCancelOpen(true)}
                >
                  {t('action.cancelJoin')}
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 'code' && awaitingApproval && !inviteCode && (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-pretty text-[12px] leading-snug text-muted-foreground">
              {t('connect.code.legacyHint')}
            </p>
            <Button
              type="button"
              variant="destructive"
              disabled={cancellingEnrollment}
              onClick={() => setCancelOpen(true)}
            >
              {t('action.cancelJoin')}
            </Button>
          </div>
        )}
      </DialogContent>
      <CancelPendingEnrollmentDialog
        open={cancelOpen}
        busy={cancellingEnrollment}
        onOpenChange={setCancelOpen}
        onConfirm={onCancelEnrollment}
      />
    </Dialog>
  )
}
