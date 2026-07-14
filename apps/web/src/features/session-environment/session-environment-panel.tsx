import {
  BookmarkLine as BookmarkIcon,
  CalendarTimeAddLine as WorkflowIcon,
  ClipboardLine as NotesIcon,
  CoinLine as UsageIcon,
  ExternalLinkLine as ExternalLinkIcon,
  GitCompareLine as DiffIcon,
  GitPullRequestLine as PullRequestIcon,
  HistoryLine as HistoryIcon,
  ServerLine as ServerIcon,
  TargetLine as TargetIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { useLocalServers } from '~/features/browser/use-local-servers'
import { useWorkDetail } from '~/features/work/use-work'
import { apiErrorMessage } from '~/lib/api-error'
import { openWorkspaceDiffs } from '~/navigation/navigation-commands'

import { sessionEnvironmentApi } from './api/session-environment'

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>

export function SessionEnvironmentPanel({
  sessionId,
  workspaceId,
  workId,
}: {
  sessionId: string
  workspaceId: string | null
  workId: string | null
}) {
  const queryClient = useQueryClient()
  const environmentQuery = useQuery({
    ...sessionEnvironmentApi.environmentQueryOptions({ path: { id: sessionId } }),
    refetchInterval: 5_000,
  })
  const workQuery = useWorkDetail(workId)
  const notesMutation = useMutation(sessionEnvironmentApi.updateNotesMutation())
  const pinPatch = useMutation(sessionEnvironmentApi.patchPinMutation())
  const pinDelete = useMutation(sessionEnvironmentApi.deletePinMutation())
  const markerPatch = useMutation(sessionEnvironmentApi.patchMarkerMutation())
  const markerDelete = useMutation(sessionEnvironmentApi.deleteMarkerMutation())
  const restore = useMutation(sessionEnvironmentApi.restoreCheckpointMutation())
  const rewind = useMutation(sessionEnvironmentApi.rewindCheckpointMutation())
  const createReview = useMutation(sessionEnvironmentApi.createReviewMutation())
  const localServers = useLocalServers(true)
  const [notesDraft, setNotesDraft] = useState('')
  const [rewindCheckpointId, setRewindCheckpointId] = useState<string | null>(null)
  const environment = environmentQuery.data

  useEffect(() => {
    setNotesDraft(environment?.notes ?? '')
  }, [environment?.notes, sessionId])

  useEffect(() => {
    if (!environment || notesDraft === environment.notes) { return }
    const timer = window.setTimeout(() => {
      void notesMutation.mutateAsync({ path: { id: sessionId }, body: { notes: notesDraft } })
        .then(() => queryClient.invalidateQueries({ queryKey: sessionEnvironmentApi.environmentQueryKey({ path: { id: sessionId } }) }))
        .catch(error => toastManager.add({ type: 'error', title: 'Notes save failed', description: apiErrorMessage(error) }))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [environment, notesDraft, notesMutation, queryClient, sessionId])

  if (!environment) {
    return <div className="flex flex-1 items-center justify-center"><Spinner className="size-4" /></div>
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionEnvironmentApi.environmentQueryKey({ path: { id: sessionId } }) })
  const latestCompletedCheckpoint = environment.checkpoints.find(checkpoint => checkpoint.status === 'completed')
  const rewindTurnCount = rewindCheckpointId
    ? environment.checkpoints.findIndex(checkpoint => checkpoint.id === rewindCheckpointId)
    : 0

  return (
    <>
      <div className="flex flex-1 flex-col overflow-y-auto p-3" data-testid="session-environment-panel">
      <div className="flex flex-col gap-4">
        {workQuery.data && (
          <section className="space-y-2">
            <SectionHeader icon={TargetIcon} label="Work" />
            <p className="text-pretty text-[13px] leading-5 text-foreground/90">{workQuery.data.work.objective}</p>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] tabular-nums">
              <Metric value={workQuery.data.readiness.changedFiles} label="files" />
              <Metric value={workQuery.data.readiness.commitsAhead} label="commits" />
              <Metric value={workQuery.data.activity} label="state" />
            </div>
            {workQuery.data.work.handoffSummary && (
              <p className="whitespace-pre-wrap text-pretty text-[11px] leading-5 text-muted-foreground">
                {workQuery.data.work.handoffSummary}
              </p>
            )}
          </section>
        )}

        {environment.handoff && (
          <section className="space-y-2">
            <SectionHeader icon={NotesIcon} label="Provider handoff" />
            <p className="text-pretty text-[11px] leading-5 text-muted-foreground">
              Imported
              {' '}
              <span className="tabular-nums">{environment.handoff.importedMessageCount}</span>
              {' '}
              messages from the previous provider thread.
            </p>
          </section>
        )}

        {environment.pullRequest && (
          <section className="space-y-2">
            <SectionHeader icon={PullRequestIcon} label="Pull request" />
            <a className="flex min-h-10 items-center gap-2 rounded-lg bg-fill/45 px-2.5 text-[11px] transition-[background-color,scale] duration-150 hover:bg-fill active:scale-[0.96]" href={environment.pullRequest.url} target="_blank" rel="noreferrer">
              <span className="min-w-0 flex-1 truncate">
#
{environment.pullRequest.number}
{' '}
{environment.pullRequest.title}
              </span>
              <ExternalLinkIcon className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
            </a>
          </section>
        )}

        <section className="space-y-2">
          <SectionHeader icon={UsageIcon} label="Usage" />
          <div className="grid grid-cols-2 gap-1.5 text-center text-[10px] tabular-nums">
            <Metric value={environment.usage.totalTokens.toLocaleString()} label="tokens" />
            <Metric value={environment.usage.count} label="turns" />
          </div>
        </section>

        {environment.checkpoints.length > 0 && (
          <section className="space-y-2">
            <SectionHeader icon={HistoryIcon} label="Turn checkpoints" />
            <div className="space-y-1.5">
              {environment.checkpoints.slice(0, 5).map(checkpoint => (
                <div key={checkpoint.id} className="rounded-lg bg-fill/35 p-2 shadow-[0_0_0_1px_rgba(127,127,127,0.12)]">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate">{checkpoint.status === 'completed' ? `${checkpoint.changedFiles} files` : checkpoint.status}</span>
                    <span className="shrink-0 tabular-nums text-emerald-600">
+
{checkpoint.additions}
                    </span>
                    <span className="shrink-0 tabular-nums text-red-500">
-
{checkpoint.deletions}
                    </span>
                  </div>
                  {checkpoint.status === 'completed' && checkpoint.endRef && workspaceId && (
                    <div className="mt-1.5 flex gap-1.5">
                      <Button size="xs" variant="outline" className="flex-1" onClick={() => void createReview.mutateAsync({ path: { workspaceId }, body: { baseRef: checkpoint.startRef, headRef: checkpoint.endRef! } }).then(review => openWorkspaceDiffs({ workspaceId, reviewId: review.id })).catch(error => toastManager.add({ type: 'error', title: 'Diff review failed', description: apiErrorMessage(error) }))}>
                        <DiffIcon className="size-3" aria-hidden="true" />
{' '}
Review
                      </Button>
                      {latestCompletedCheckpoint?.id === checkpoint.id && (
                        <Button size="xs" variant="outline" className="flex-1" disabled={restore.isPending} onClick={() => void restore.mutateAsync({ path: { id: sessionId, checkpointId: checkpoint.id } }).then(refresh).catch(error => toastManager.add({ type: 'error', title: 'Restore failed', description: apiErrorMessage(error) }))}>
                          Undo turn
                        </Button>
                      )}
                      {latestCompletedCheckpoint?.id !== checkpoint.id && (
                        <Button size="xs" variant="outline" className="flex-1" title="Rewind this session and discard later turns" disabled={rewind.isPending} onClick={() => setRewindCheckpointId(checkpoint.id)}>
                          Rewind
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {environment.pins.length > 0 && (
          <ChecklistSection icon={BookmarkIcon} label="Pinned" items={environment.pins.map(pin => ({ id: pin.messageId, targetMessageId: pin.messageId, label: pin.label ?? pin.messageId.slice(0, 8), done: pin.done }))} onDone={(id, done) => void pinPatch.mutateAsync({ path: { id: sessionId, messageId: id }, body: { done } }).then(refresh)} onRemove={id => void pinDelete.mutateAsync({ path: { id: sessionId, messageId: id } }).then(refresh)} />
        )}

        {environment.markers.length > 0 && (
          <ChecklistSection icon={BookmarkIcon} label="Markers" items={environment.markers.map(marker => ({ id: marker.id, targetMessageId: marker.messageId, label: marker.label ?? marker.selectedText, done: marker.done }))} onDone={(id, done) => void markerPatch.mutateAsync({ path: { id: sessionId, markerId: id }, body: { done } }).then(refresh)} onRemove={id => void markerDelete.mutateAsync({ path: { id: sessionId, markerId: id } }).then(refresh)} />
        )}

        <section className="space-y-2">
          <SectionHeader icon={NotesIcon} label="Notes" />
          <textarea value={notesDraft} onChange={event => setNotesDraft(event.target.value)} placeholder="Keep session notes here…" className="min-h-28 w-full resize-y rounded-lg bg-fill/35 px-2.5 py-2 text-[12px] leading-5 outline-none shadow-[0_0_0_1px_rgba(127,127,127,0.14)] transition-[box-shadow] focus:shadow-[0_0_0_1px_var(--color-ring)]" />
        </section>

        {environment.automationRuns.length > 0 && (
          <section className="space-y-2">
            <SectionHeader icon={WorkflowIcon} label="Automation" />
            {environment.automationRuns.map(run => <Property key={run.id} label={run.id.slice(0, 8)} value={run.status} />)}
          </section>
        )}

        {(localServers.servers.length > 0 || localServers.loading || localServers.error) && (
          <section className="space-y-2">
            <SectionHeader icon={ServerIcon} label="Local servers" />
            {localServers.servers.map(server => (
              <button key={server.url} type="button" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] transition-[background-color,scale] hover:bg-fill active:scale-[0.96]" onClick={() => window.open(server.url, '_blank', 'noopener,noreferrer')}>
                <span className="min-w-0 flex-1 truncate">{server.title}</span>
                <span className="tabular-nums text-muted-foreground">
:
{server.port}
                </span>
              </button>
            ))}
            {localServers.loading && <p className="text-[11px] text-muted-foreground">Scanning localhost…</p>}
            {!localServers.loading && localServers.error && <p className="text-pretty text-[11px] text-muted-foreground">{localServers.error}</p>}
          </section>
        )}
      </div>
      </div>
      <AlertDialog open={rewindCheckpointId !== null} onOpenChange={open => !open && setRewindCheckpointId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Rewind this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the selected checkpoint and permanently discards
              {' '}
              {rewindTurnCount}
              {' '}
              later
              {' '}
              {rewindTurnCount === 1 ? 'turn' : 'turns'}
              {' '}
              from this conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rewind.isPending || !rewindCheckpointId}
              onClick={(event) => {
                event.preventDefault()
                if (!rewindCheckpointId) { return }
                void rewind.mutateAsync({ path: { id: sessionId, checkpointId: rewindCheckpointId } })
                  .then(() => {
                    setRewindCheckpointId(null)
                    return refresh()
                  })
                  .catch(error => toastManager.add({ type: 'error', title: 'Rewind failed', description: apiErrorMessage(error) }))
              }}
            >
              Rewind
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SectionHeader({ icon: Icon, label }: { icon: IconType, label: string }) {
  return (
<div className="flex items-center gap-1.5">
<Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
<span className="text-[11px] font-semibold text-foreground/80">{label}</span>
</div>
)
}

function Metric({ value, label }: { value: string | number, label: string }) {
  return (
<div className="rounded-lg bg-fill/35 px-2 py-1.5">
<div className="truncate font-medium text-foreground/90">{value}</div>
<div className="text-muted-foreground">{label}</div>
</div>
)
}

function Property({ label, value }: { label: string, value: string }) {
  return (
<div className="flex items-center justify-between gap-2 py-1 text-[11px]">
<span className="truncate text-muted-foreground">{label}</span>
<span className="shrink-0 tabular-nums text-foreground/80">{value}</span>
</div>
)
}

function ChecklistSection({ icon, label, items, onDone, onRemove }: { icon: IconType, label: string, items: Array<{ id: string, targetMessageId: string, label: string, done: boolean }>, onDone: (id: string, done: boolean) => void, onRemove: (id: string) => void }) {
  return (
<section className="space-y-2">
<SectionHeader icon={icon} label={label} />
<div>
{items.map(item => (
<div key={item.id} className="group flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-fill/45">
<Checkbox checked={item.done} onCheckedChange={() => onDone(item.id, !item.done)} />
<button type="button" className={item.done ? 'min-h-10 min-w-0 flex-1 truncate text-left text-[11px] text-muted-foreground line-through' : 'min-h-10 min-w-0 flex-1 truncate text-left text-[11px]'} onClick={() => document.querySelector(`[data-message-id="${CSS.escape(item.targetMessageId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{item.label}</button>
<Button size="icon-xs" variant="ghost" className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(item.id)} aria-label={`Remove ${label.toLowerCase()} item`}>×</Button>
</div>
))}
</div>
</section>
)
}
