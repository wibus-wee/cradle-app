import {
  CheckLine as CheckIcon,
  DownLine as ChevronDownIcon,
  DownloadLine as DownloadIcon,
  ExternalLinkLine as ExternalLinkIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { ButtonGroup } from '~/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { nativeIpc } from '~/lib/electron'

import { AcpAgentIcon } from './acp-agent-icon'
import type { AcpDistributionType, AcpInstalledAgent, AcpRegistryAgent } from './use-acp-registry'
import { listAcpDistributionTypes, useAcpAgentMutations } from './use-acp-registry'
import { CreateAgentButton, UsedBySection } from './used-by-section'

function openExternalLink(url: string) {
  const openExternal = nativeIpc?.native?.openExternal
  if (openExternal) {
    void openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function InstallStateIcon({ state }: { state: 'idle' | 'installing' | 'ready' }) {
  return (
    <span className="relative inline-flex size-3.5 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={state}
          className="absolute inline-flex"
          initial={{ scale: 0.25, opacity: 0, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
          exit={{ scale: 0.25, opacity: 0, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 600, damping: 40, bounce: 0 }}
        >
          {state === 'idle' && <DownloadIcon className="size-3.5" />}
          {state === 'installing' && <Spinner className="size-3.5" />}
          {state === 'ready' && <CheckIcon className="size-3.5" />}
        </m.span>
      </AnimatePresence>
    </span>
  )
}

export function AcpRegistryDetail({
  agent,
  installed,
  usedByAgents,
}: {
  agent: AcpRegistryAgent
  installed: AcpInstalledAgent | undefined
  usedByAgents: Agent[]
}) {
  const { t } = useTranslation('runtimes')
  const { installAgent, cancelInstall, uninstallAgent } = useAcpAgentMutations()

  const distributionTypes = listAcpDistributionTypes(agent)
  const preferredType = distributionTypes[0]
  const status = installed?.status ?? null
  const isReady = status === 'installed'
  const isFailed = status === 'failed'
  const updateAvailable = isReady && installed?.version != null && installed.version !== agent.version

  const handleInstall = (distributionType: AcpDistributionType) => {
    installAgent.mutate(
      { path: { agentId: agent.id }, body: { distributionType } },
      {
        onError: error => toastManager.add({
          type: 'error',
          title: t('toast.installError', { name: agent.name }),
          description: errorMessage(error),
        }),
      },
    )
  }

  const handleCancel = () => {
    cancelInstall.mutate(
      { path: { agentId: agent.id } },
      {
        onError: error => toastManager.add({
          type: 'error',
          title: t('toast.cancelError'),
          description: errorMessage(error),
        }),
      },
    )
  }

  const handleUninstall = () => {
    uninstallAgent.mutate(
      { path: { agentId: agent.id } },
      {
        onError: error => toastManager.add({
          type: 'error',
          title: t('toast.uninstallError', { name: agent.name }),
          description: errorMessage(error),
        }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-5 p-6" data-testid={`acp-detail-${agent.id}`}>
      {/* Header */}
      <header className="flex items-start gap-3.5">
        <AcpAgentIcon iconUrl={agent.icon} className="size-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-foreground">{agent.name}</h2>
            <span className="inline-flex shrink-0 items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {t('chip.agent')}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-text-tertiary">
            <span className="font-mono tabular-nums">
              {t('detail.versionChip', { version: agent.version })}
            </span>
            {agent.license && <span>{agent.license}</span>}
            {agent.authors && agent.authors.length > 0 && (
              <span className="truncate">{agent.authors.join(', ')}</span>
            )}
          </div>
        </div>
      </header>

      {/* Description */}
      {agent.description && (
        <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
          {agent.description}
        </p>
      )}

      {/* Links + distributions */}
      {(agent.repository || agent.website || distributionTypes.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {agent.repository && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px]"
              onClick={() => openExternalLink(agent.repository!)}
            >
              <ExternalLinkIcon className="size-3.5" />
              {t('detail.links.repository')}
            </Button>
          )}
          {agent.website && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px]"
              onClick={() => openExternalLink(agent.website!)}
            >
              <ExternalLinkIcon className="size-3.5" />
              {t('detail.links.website')}
            </Button>
          )}
          {distributionTypes.map(type => (
            <span
              key={type}
              className="inline-flex items-center rounded-sm bg-fill px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary"
            >
              {type}
            </span>
          ))}
        </div>
      )}

      {/* Action area */}
      <div className="flex flex-col gap-2.5">
        {!status && preferredType && (
          <div className="flex items-center gap-2">
            <ButtonGroup>
              <Button
                onClick={() => handleInstall(preferredType)}
                disabled={installAgent.isPending}
                data-testid="acp-install"
              >
                <InstallStateIcon state={installAgent.isPending ? 'installing' : 'idle'} />
                {t('detail.action.install')}
              </Button>
              {distributionTypes.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-label={t('detail.action.install')} className="px-1.5">
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {distributionTypes.map(type => (
                      <DropdownMenuItem key={type} onClick={() => handleInstall(type)}>
                        {t('detail.action.installWith', { type })}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </ButtonGroup>
          </div>
        )}

        {status === 'installing' && (
          <div className="flex items-center gap-2">
            <Button disabled>
              <InstallStateIcon state="installing" />
              {t('detail.action.installing')}
            </Button>
            <Button variant="ghost" onClick={handleCancel} disabled={cancelInstall.isPending}>
              {t('detail.action.cancel')}
            </Button>
          </div>
        )}

        {isReady && installed && (
          <>
            <p className="font-mono text-[12px] tabular-nums text-text-tertiary">
              {t('detail.installedLine', {
                version: installed.version ?? agent.version,
                distributionType: installed.distributionType,
              })}
            </p>
            <div className="flex items-center gap-2">
              {updateAvailable && (
                <Button
                  size="sm"
                  onClick={() => handleInstall(installed.distributionType as AcpDistributionType)}
                  disabled={installAgent.isPending}
                  data-testid="acp-update"
                >
                  <InstallStateIcon state={installAgent.isPending ? 'installing' : 'idle'} />
                  {t('detail.action.update')}
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    data-testid="acp-uninstall"
                  >
                    {t('detail.action.uninstall')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('uninstall.title', { name: agent.name })}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('uninstall.description')}
                      {usedByAgents.length > 0 && (
                        <span className="mt-1.5 block text-destructive">
                          {t('uninstall.inUse', { count: usedByAgents.length })}
                        </span>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('uninstall.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUninstall}
                      className="bg-destructive text-white hover:bg-destructive/90"
                      data-testid="acp-uninstall-confirm"
                    >
                      {t('uninstall.confirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}

        {isFailed && (
          <>
            <p className="text-[12px] text-destructive">{t('detail.installFailed')}</p>
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleInstall(
                  (installed?.distributionType as AcpDistributionType | undefined) ?? preferredType!,
                )}
                disabled={installAgent.isPending || !preferredType}
                data-testid="acp-retry"
              >
                <InstallStateIcon state={installAgent.isPending ? 'installing' : 'idle'} />
                {t('detail.action.retry')}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Used by + create */}
      <UsedBySection agents={usedByAgents} />
      {isReady && (
        <div>
          <CreateAgentButton runtimeKind="acp-chat" acpAgentId={agent.id} />
        </div>
      )}
    </div>
  )
}
