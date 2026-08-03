import {
  ArrowDownLine as ChevronIcon,
  PlusLine as PlusIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'

import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { SettingsGroup, SettingsPage } from './settings-container'

export type RemoteHostsSettingsHost = GetRemoteHostsResponse[number]

export interface RemoteHostsSettingsViewCopy {
  title: string
  description: string
  addHost: string
  loading: string
  emptyTitle: string
  guideIntro: string
  guideToggle: string
  guideSteps: Array<{ title: string, detail: string }>
  relayNote: string
  otherComputers: string
  otherComputersDescription: string
}

export interface RemoteHostsSettingsViewProps {
  copy: RemoteHostsSettingsViewCopy
  hosts: RemoteHostsSettingsHost[]
  loading: boolean
  guideOpen: boolean
  revealHostId: string | null
  onAddHost: () => void
  onGuideOpenChange: (open: boolean) => void
  renderHost: (host: RemoteHostsSettingsHost, reveal: boolean) => ReactNode
  hostEnrollmentsSlot: ReactNode
  relayServersSlot: ReactNode
  pairComputerSlot: ReactNode
}

function SetupGuide({ copy, onAddHost }: {
  copy: RemoteHostsSettingsViewCopy
  onAddHost: () => void
}) {
  return (
    <ol className="space-y-0">
      {copy.guideSteps.map((step, index) => (
        <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
          {index < copy.guideSteps.length - 1 && (
            <span
              className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border/70"
              aria-hidden="true"
            />
          )}
          <span className="relative z-10 mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[12.5px] font-medium leading-tight text-foreground">{step.title}</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground/80">{step.detail}</p>
            {index === 1 && (
              <Button size="sm" onClick={onAddHost}>
                <PlusIcon className="size-3.5" aria-hidden="true" />
                {copy.addHost}
              </Button>
            )}
            {index === copy.guideSteps.length - 1 && (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground/70">
                {copy.relayNote}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function RemoteHostsEmptyState({ copy, onAddHost }: {
  copy: RemoteHostsSettingsViewCopy
  onAddHost: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-7 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-foreground/5 text-foreground/70">
        <ServerIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{copy.emptyTitle}</h2>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.guideIntro}</p>
      </div>
      <div className="w-full max-w-md text-left">
        <SetupGuide copy={copy} onAddHost={onAddHost} />
      </div>
      <Button size="sm" onClick={onAddHost}>
        <PlusIcon className="size-3.5" aria-hidden="true" />
        {copy.addHost}
      </Button>
    </div>
  )
}

export function RemoteHostsSettingsView({
  copy,
  hosts,
  loading,
  guideOpen,
  revealHostId,
  onAddHost,
  onGuideOpenChange,
  renderHost,
  hostEnrollmentsSlot,
  relayServersSlot,
  pairComputerSlot,
}: RemoteHostsSettingsViewProps) {
  return (
    <SettingsPage
      title={copy.title}
      description={copy.description}
      action={(
        <Button data-testid="add-remote-host-btn" size="sm" onClick={onAddHost}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {copy.addHost}
        </Button>
      )}
      data-testid="remote-hosts-settings"
    >
      {hostEnrollmentsSlot}
      {loading
        ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {copy.loading}
            </div>
          )
        : hosts.length === 0
          ? <RemoteHostsEmptyState copy={copy} onAddHost={onAddHost} />
          : (
              <>
                <Collapsible open={guideOpen} onOpenChange={onGuideOpenChange}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronIcon
                        className={cn('size-3.5 transition-transform', guideOpen ? 'rotate-0' : '-rotate-90')}
                        aria-hidden="true"
                      />
                      {copy.guideToggle}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <div className="rounded-xl border border-border bg-card p-5">
                      <SetupGuide copy={copy} onAddHost={onAddHost} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <SettingsGroup
                  label={copy.otherComputers}
                  description={copy.otherComputersDescription}
                  bare
                  className="[&>*+*]:border-t [&>*+*]:border-border/60"
                >
                  {hosts.map(host => renderHost(host, revealHostId === host.id))}
                </SettingsGroup>
              </>
            )}
      {relayServersSlot}
      {pairComputerSlot}
    </SettingsPage>
  )
}
