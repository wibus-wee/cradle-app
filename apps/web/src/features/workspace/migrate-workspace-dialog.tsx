import {
  AlertLine as AlertIcon,
  CheckCircleLine as CheckCircleIcon,
  CheckLine as CheckIcon,
  Columns2Line as KanbanIcon,
  DotCircleLine as DotCircleIcon,
  FlashLine as AutomationIcon,
  HashtagLine as IssueIcon,
  InformationLine as InfoIcon,
  LeftSmallLine as ArrowLeftIcon,
  LoadingLine,
  PlayLine as PlayIcon,
  Refresh1Line as RefreshIcon,
  RightSmallLine as ArrowRightIcon,
  RouteLine as RouteIcon,
  SendLine as SendIcon,
  ShuffleLine as ShuffleIcon,
  SparklesLine as SparklesIcon,
  TransferVerticalLine as TransferIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { AnimatePresence, m } from 'motion/react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getIssuesMilestonesOptions,
  getIssuesStatusesOptions,
  getWorkspacesOptions,
  postWorkspacesByWorkspaceIdMigrateMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { PostWorkspacesByWorkspaceIdMigrateResponse } from '~/api-gen/types.gen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { ScrollArea } from '~/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { TruncatedText } from '~/components/ui/truncated-text'
import { getWorkspaceLocationLabel } from '~/features/workspace/types'
import { WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

type MigrateEntity = 'issues' | 'kanban' | 'automation'
type Step = 0 | 1 | 2

const ALL_ENTITIES: MigrateEntity[] = ['issues', 'kanban', 'automation']
const STATUS_FALLBACK = '__default__'
const MILESTONE_CLEAR = '__clear__'

interface StatusRow {
  id: string
  name: string
  color: string | null
}

interface MilestoneRow {
  id: string
  title: string
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (typeof error === 'string') {
    return error
  }
  return JSON.stringify(error)
}

function colorDot(color: string | null): string {
  return color ?? 'var(--muted-foreground)'
}

/* ─── Step indicator ─────────────────────────────────────── */

const STEP_DEFS = [
  { icon: RouteIcon, labelKey: 'workspace.migrate.step.destinations' },
  { icon: ShuffleIcon, labelKey: 'workspace.migrate.step.mappings' },
  { icon: CheckCircleIcon, labelKey: 'workspace.migrate.step.review' },
] as const

function StepIndicator({ step, t }: { step: Step, t: TFunction<'workspace'> }) {
  return (
    <div className="flex items-center gap-1">
      {STEP_DEFS.map((def, index) => {
        const isActive = index === step
        const isDone = index < step
        const Icon = def.icon
        return (
          <Fragment key={def.labelKey}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border transition-all duration-200',
                  isActive && 'border-foreground bg-foreground text-background',
                  isDone && 'border-foreground/40 text-foreground',
                  !isActive && !isDone && 'border-border text-muted-foreground/60',
                )}
              >
                {isDone
                  ? <CheckIcon className="size-3.5" />
                  : <Icon className="size-3.5" />}
              </div>
              <span
                className={cn(
                  'text-[12px] font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {t(def.labelKey)}
              </span>
            </div>
            {index < STEP_DEFS.length - 1 && (
              <div className={cn('mx-1.5 h-px w-5 transition-colors duration-300 sm:w-7', isDone ? 'bg-foreground/30' : 'bg-border')} />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/* ─── Mapping tables ─────────────────────────────────────── */

function StatusMappingTable({
  sourceStatuses,
  targetStatuses,
  mappings,
  onMappingChange,
  t,
}: {
  sourceStatuses: StatusRow[]
  targetStatuses: StatusRow[]
  mappings: Record<string, string>
  onMappingChange: (source: string, target: string | null) => void
  t: TFunction<'workspace'>
}) {
  const targetByName = useMemo(
    () => new Map(targetStatuses.map(s => [s.name.toLowerCase(), s])),
    [targetStatuses],
  )

  if (sourceStatuses.length === 0) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DotCircleIcon className="size-4" />
          </EmptyMedia>
          <EmptyTitle>{t('workspace.migrate.mappings.empty.statuses')}</EmptyTitle>
          <EmptyDescription>{t('workspace.migrate.mappings.empty.statusesHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('workspace.migrate.mappings.source')}
            </TableHead>
            <TableHead className="h-9 w-8" />
            <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('workspace.migrate.mappings.target')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sourceStatuses.map((source) => {
            const autoMatch = targetByName.get(source.name.toLowerCase())
            const stored = mappings[source.name]
            const value = stored ?? autoMatch?.name ?? STATUS_FALLBACK
            return (
              <TableRow key={source.id} className="border-border">
                <TableCell className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/10"
                      style={{ backgroundColor: colorDot(source.color) }}
                    />
                    <span className="text-[13px] text-foreground">{source.name}</span>
                    {stored && autoMatch && stored !== autoMatch.name && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-muted-foreground">
                        {t('workspace.migrate.mappings.override')}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-2.5">
                  <ArrowRightIcon className="size-3.5 text-muted-foreground/50" />
                </TableCell>
                <TableCell className="py-2.5">
                  <Select
                    value={value}
                    onValueChange={(next) => {
                      onMappingChange(source.name, next === STATUS_FALLBACK ? null : next)
                    }}
                  >
                    <SelectTrigger size="sm" className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={STATUS_FALLBACK}>
                        <span className="text-muted-foreground">{t('workspace.migrate.mappings.fallback')}</span>
                      </SelectItem>
                      {targetStatuses.map(target => (
                        <SelectItem key={target.id} value={target.name}>
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: colorDot(target.color) }}
                            />
                            {target.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function MilestoneMappingTable({
  sourceMilestones,
  targetMilestones,
  mappings,
  onMappingChange,
  t,
}: {
  sourceMilestones: MilestoneRow[]
  targetMilestones: MilestoneRow[]
  mappings: Record<string, string>
  onMappingChange: (source: string, target: string | null) => void
  t: TFunction<'workspace'>
}) {
  const targetByTitle = useMemo(
    () => new Map(targetMilestones.map(m => [m.title.toLowerCase(), m])),
    [targetMilestones],
  )

  if (sourceMilestones.length === 0) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DotCircleIcon className="size-4" />
          </EmptyMedia>
          <EmptyTitle>{t('workspace.migrate.mappings.empty.milestones')}</EmptyTitle>
          <EmptyDescription>{t('workspace.migrate.mappings.empty.milestonesHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('workspace.migrate.mappings.source')}
            </TableHead>
            <TableHead className="h-9 w-8" />
            <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('workspace.migrate.mappings.target')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sourceMilestones.map((source) => {
            const autoMatch = targetByTitle.get(source.title.toLowerCase())
            const stored = mappings[source.title]
            const value = stored !== undefined ? stored : (autoMatch?.title ?? MILESTONE_CLEAR)
            return (
              <TableRow key={source.id} className="border-border">
                <TableCell className="py-2.5">
                  <span className="text-[13px] text-foreground">{source.title}</span>
                </TableCell>
                <TableCell className="py-2.5">
                  <ArrowRightIcon className="size-3.5 text-muted-foreground/50" />
                </TableCell>
                <TableCell className="py-2.5">
                  <Select
                    value={value}
                    onValueChange={(next) => {
                      onMappingChange(source.title, next === MILESTONE_CLEAR ? null : next)
                    }}
                  >
                    <SelectTrigger size="sm" className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MILESTONE_CLEAR}>
                        <span className="text-muted-foreground">{t('workspace.migrate.mappings.clear')}</span>
                      </SelectItem>
                      {targetMilestones.map(target => (
                        <SelectItem key={target.id} value={target.title}>
                          {target.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/* ─── Review summary ─────────────────────────────────────── */

function StatCell({ label, value, tone = 'default' }: { label: string, value: number, tone?: 'default' | 'warn' }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-xl font-semibold tabular-nums leading-none',
          tone === 'warn' && value > 0 ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function PreviewSummary({
  result,
  targetName,
  t,
}: {
  result: PostWorkspacesByWorkspaceIdMigrateResponse
  targetName: string
  t: TFunction<'workspace'>
}) {
  const { issues, kanban, automation } = result

  return (
    <div className="grid gap-3">
      {/* Stat grid */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3">
        <StatCell label={t('workspace.migrate.review.stat.issuesProcessed')} value={issues.processed} />
        <div className="border-t border-border sm:border-t-0 sm:border-l">
          <StatCell label={t('workspace.migrate.review.stat.issuesUpdated')} value={issues.updated} />
        </div>
        <div className="border-t border-border sm:border-l">
          <StatCell label={t('workspace.migrate.review.stat.boardsMoved')} value={kanban.boardsMoved} />
        </div>
        <div className="border-t border-border">
          <StatCell label={t('workspace.migrate.review.stat.numbersReassigned')} value={issues.numbersReassigned} tone="warn" />
        </div>
        <div className="border-t border-l border-border">
          <StatCell label={t('workspace.migrate.review.stat.definitionsMoved')} value={automation.definitionsMoved} />
        </div>
        <div className="border-t border-l border-border">
          <StatCell label={t('workspace.migrate.review.stat.parentCleared')} value={issues.parentIssuesCleared} tone="warn" />
        </div>
      </div>

      {/* Mapping details */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Collapsible>
          <div className="rounded-xl border border-border bg-card">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40">
              <span className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                <ShuffleIcon className="size-3.5 text-muted-foreground" />
                {t('workspace.migrate.review.statusesMapped')}
              </span>
              <Badge variant="secondary" className="font-mono text-[10px]">{issues.statusesMapped.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Separator />
              <ScrollArea className="max-h-40">
                <div className="px-3.5 py-2">
                  {issues.statusesMapped.map((row, i) => (
                    <div key={`s-${row.from}-${i}`} className="flex items-center gap-2 py-1 text-[12px]">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.from}</span>
                      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
                      <span className="min-w-0 flex-1 truncate text-right font-medium text-foreground">{row.to}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <Collapsible>
          <div className="rounded-xl border border-border bg-card">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40">
              <span className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                <DotCircleIcon className="size-3.5 text-muted-foreground" />
                {t('workspace.migrate.review.milestonesMapped')}
              </span>
              <Badge variant="secondary" className="font-mono text-[10px]">{issues.milestonesMapped.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Separator />
              <ScrollArea className="max-h-40">
                <div className="px-3.5 py-2">
                  {issues.milestonesMapped.map((row, i) => (
                    <div key={`m-${row.from}-${i}`} className="flex items-center gap-2 py-1 text-[12px]">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.from}</span>
                      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
                      <span className={cn('min-w-0 flex-1 truncate text-right', row.to ? 'font-medium text-foreground' : 'italic text-muted-foreground/70')}>
                        {row.to ?? t('workspace.migrate.review.cleared')}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>

      <Alert variant="destructive" className="rounded-xl">
        <AlertIcon className="size-4" />
        <AlertTitle>{t('workspace.migrate.review.warningTitle')}</AlertTitle>
        <AlertDescription>
          {t('workspace.migrate.review.warningBody', { target: targetName })}
        </AlertDescription>
      </Alert>
    </div>
  )
}

function SkeletonMappingTable({ t }: { t: TFunction<'workspace'> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('workspace.migrate.mappings.source')}
            </TableHead>
            <TableHead className="h-9 w-8" />
            <TableHead className="h-9 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('workspace.migrate.mappings.target')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i} className="border-border">
              <TableCell className="py-3"><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell className="py-3" />
              <TableCell className="py-3"><Skeleton className="h-8 w-full" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/* ─── Main dialog ────────────────────────────────────────── */

export interface MigrateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceWorkspaceId: string
}

const ENTITY_META = {
  issues: { icon: IssueIcon, labelKey: 'workspace.migrate.entity.issues', descKey: 'workspace.migrate.entity.issues.desc' },
  kanban: { icon: KanbanIcon, labelKey: 'workspace.migrate.entity.kanban', descKey: 'workspace.migrate.entity.kanban.desc' },
  automation: { icon: AutomationIcon, labelKey: 'workspace.migrate.entity.automation', descKey: 'workspace.migrate.entity.automation.desc' },
} as const satisfies Record<MigrateEntity, { icon: typeof IssueIcon, labelKey: string, descKey: string }>

export function MigrateWorkspaceDialog({ open, onOpenChange, sourceWorkspaceId }: MigrateWorkspaceDialogProps) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const migrateMutation = useMutation({ ...postWorkspacesByWorkspaceIdMigrateMutation() })

  const [step, setStep] = useState<Step>(0)
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('')
  const [entities, setEntities] = useState<Set<MigrateEntity>>(() => new Set(ALL_ENTITIES))
  const [statusMappings, setStatusMappings] = useState<Record<string, string>>({})
  const [milestoneMappings, setMilestoneMappings] = useState<Record<string, string>>({})
  const [onlyUnmapped, setOnlyUnmapped] = useState(false)
  const [preview, setPreview] = useState<PostWorkspacesByWorkspaceIdMigrateResponse | null>(null)
  const [migrating, setMigrating] = useState(false)

  const { data: workspaces = [] } = useQuery({ ...getWorkspacesOptions(), enabled: open })
  const sourceWorkspace = workspaces.find(w => w.id === sourceWorkspaceId)
  const targetWorkspace = workspaces.find(w => w.id === targetWorkspaceId)
  const targetOptions = useMemo(() => workspaces.filter(w => w.id !== sourceWorkspaceId), [workspaces, sourceWorkspaceId])

  const issuesSelected = entities.has('issues')

  // Reset everything when the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setStep(0)
      setTargetWorkspaceId('')
      setEntities(new Set(ALL_ENTITIES))
      setStatusMappings({})
      setMilestoneMappings({})
      setOnlyUnmapped(false)
      setPreview(null)
      setMigrating(false)
      migrateMutation.reset()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset mappings + preview when the target changes.
  useEffect(() => {
    setStatusMappings({})
    setMilestoneMappings({})
    setPreview(null)
  }, [targetWorkspaceId])

  const { data: sourceStatuses } = useQuery({
    ...getIssuesStatusesOptions({ query: { workspaceId: sourceWorkspaceId } }),
    enabled: open && issuesSelected,
  })
  const { data: targetStatuses } = useQuery({
    ...getIssuesStatusesOptions({ query: { workspaceId: targetWorkspaceId } }),
    enabled: open && issuesSelected && !!targetWorkspaceId,
  })
  const { data: sourceMilestones } = useQuery({
    ...getIssuesMilestonesOptions({ query: { workspaceId: sourceWorkspaceId } }),
    enabled: open && issuesSelected,
  })
  const { data: targetMilestones } = useQuery({
    ...getIssuesMilestonesOptions({ query: { workspaceId: targetWorkspaceId } }),
    enabled: open && issuesSelected && !!targetWorkspaceId,
  })

  const sourceStatusRows: StatusRow[] = useMemo(
    () => (sourceStatuses ?? []).map(s => ({ id: s.id, name: s.name, color: s.color })),
    [sourceStatuses],
  )
  const targetStatusRows: StatusRow[] = useMemo(
    () => (targetStatuses ?? []).map(s => ({ id: s.id, name: s.name, color: s.color })),
    [targetStatuses],
  )
  const sourceMilestoneRows: MilestoneRow[] = useMemo(
    () => (sourceMilestones ?? []).map(m => ({ id: m.id, title: m.title })),
    [sourceMilestones],
  )
  const targetMilestoneRows: MilestoneRow[] = useMemo(
    () => (targetMilestones ?? []).map(m => ({ id: m.id, title: m.title })),
    [targetMilestones],
  )

  const toggleEntity = useCallback((entity: MigrateEntity) => {
    setEntities((prev) => {
      const next = new Set(prev)
      if (next.has(entity)) {
        next.delete(entity)
      }
      else {
        next.add(entity)
      }
      return next
    })
    setPreview(null)
  }, [])

  const handleStatusMapping = useCallback((source: string, target: string | null) => {
    setStatusMappings((prev) => {
      const next = { ...prev }
      if (target === null) {
        delete next[source]
      }
      else {
        next[source] = target
      }
      return next
    })
    setPreview(null)
  }, [])

  const handleMilestoneMapping = useCallback((source: string, target: string | null) => {
    setMilestoneMappings((prev) => {
      const next = { ...prev }
      if (target === null) {
        delete next[source]
      }
      else {
        next[source] = target
      }
      return next
    })
    setPreview(null)
  }, [])

  const buildBody = useCallback((dryRun: boolean) => ({
    targetWorkspaceId,
    entities: Array.from(entities),
    statusMappings: Object.keys(statusMappings).length > 0 ? statusMappings : undefined,
    milestoneMappings: Object.keys(milestoneMappings).length > 0 ? milestoneMappings : undefined,
    dryRun,
  }), [targetWorkspaceId, entities, statusMappings, milestoneMappings])

  const runPreview = useCallback(async () => {
    setMigrating(true)
    try {
      const result = await migrateMutation.mutateAsync({
        path: { workspaceId: sourceWorkspaceId },
        body: buildBody(true),
      })
      setPreview(result)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.migrate.toast.previewFailed'),
        description: formatError(error),
      })
    }
    finally {
      setMigrating(false)
    }
  }, [buildBody, migrateMutation, sourceWorkspaceId, t])

  const runMigrate = useCallback(async () => {
    setMigrating(true)
    try {
      const result = await migrateMutation.mutateAsync({
        path: { workspaceId: sourceWorkspaceId },
        body: buildBody(false),
      })
      const moved = result.issues.updated + result.kanban.boardsMoved + result.automation.definitionsMoved
      toastManager.add({
        type: 'success',
        title: t('workspace.migrate.toast.success'),
        description: t('workspace.migrate.toast.successDesc', { count: moved, target: targetWorkspace?.name ?? '' }),
      })
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: ['issues'] })
      void queryClient.invalidateQueries({ queryKey: ['kanban'] })
      void queryClient.invalidateQueries({ queryKey: ['automations'] })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('workspace.migrate.toast.failed'),
        description: formatError(error),
      })
    }
    finally {
      setMigrating(false)
    }
  }, [buildBody, migrateMutation, onOpenChange, queryClient, sourceWorkspaceId, t, targetWorkspace?.name])

  const canNextFromDestinations = !!targetWorkspaceId && entities.size > 0
  const previewing = migrating && !preview

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!migrating}
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">{t('workspace.migrate.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('workspace.migrate.description')}</DialogDescription>

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border px-7 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
                {t('workspace.migrate.title')}
              </h2>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {t('workspace.migrate.description')}
              </p>
            </div>
            <Popover>
              <PopoverTrigger
                render={(
                  <button
                    type="button"
                    aria-label={t('workspace.migrate.help.aria')}
                    className="mt-0.5 flex size-7 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <InfoIcon className="size-4" />
                  </button>
                )}
              />
              <PopoverContent side="bottom" align="end" className="w-80 text-[12px] leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">{t('workspace.migrate.help.title')}</p>
                <p className="mt-1.5">{t('workspace.migrate.help.body')}</p>
                <ul className="mt-2.5 grid gap-2">
                  <li className="flex items-start gap-2">
                    <IssueIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t('workspace.migrate.help.issues')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <KanbanIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t('workspace.migrate.help.kanban')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AutomationIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t('workspace.migrate.help.automation')}</span>
                  </li>
                </ul>
              </PopoverContent>
            </Popover>
          </div>
          <StepIndicator step={step} t={t} />
        </div>

        {/* Body */}
        <ScrollArea className="max-h-[58vh] min-h-0">
          <div className="px-7 py-6">
            <AnimatePresence mode="wait">
              <m.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {/* Step 1 — Destinations & Entities */}
                {step === 0 && (
                  <div className="grid gap-6">
                    {/* Route */}
                    <section>
                      <div className="mb-2.5 flex items-center gap-1.5">
                        <RouteIcon className="size-3.5 text-muted-foreground" />
                        <h3 className="text-[13px] font-medium text-foreground">{t('workspace.migrate.route.label')}</h3>
                        <span className="text-[12px] text-muted-foreground">·</span>
                        <span className="text-[12px] text-muted-foreground">{t('workspace.migrate.route.description')}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto_1fr] overflow-hidden rounded-xl border border-border bg-card">
                        {/* Source */}
                        <div className="p-4">
                          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {t('workspace.migrate.source.label')}
                          </div>
                          <TruncatedText maxLines={1} className="text-[14px] font-medium text-foreground">
                            {sourceWorkspace?.name ?? '—'}
                          </TruncatedText>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {sourceWorkspace ? getWorkspaceLocationLabel(sourceWorkspace) : ''}
                          </p>
                        </div>
                        {/* Connector */}
                        <div className="flex items-center justify-center border-x border-border bg-muted/20 px-2">
                          <div className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                            <ArrowRightIcon className="size-3.5" />
                          </div>
                        </div>
                        {/* Target */}
                        <div className="p-4">
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <SendIcon className="size-3" />
                            {t('workspace.migrate.target.label')}
                          </div>
                          {targetWorkspace
                            ? (
                                <>
                                  <TruncatedText maxLines={1} className="text-[14px] font-medium text-foreground">
                                    {targetWorkspace.name}
                                  </TruncatedText>
                                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                    {getWorkspaceLocationLabel(targetWorkspace)}
                                  </p>
                                </>
                              )
                            : (
                                <Select value={targetWorkspaceId} onValueChange={setTargetWorkspaceId}>
                                  <SelectTrigger size="sm" className="h-9 w-full">
                                    <SelectValue placeholder={t('workspace.migrate.target.placeholder')} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {targetOptions.map(w => (
                                      <SelectItem key={w.id} value={w.id}>
                                        <span className="flex flex-col gap-0.5 py-0.5">
                                          <span>{w.name}</span>
                                          <span className="font-mono text-[10px] text-muted-foreground">{getWorkspaceLocationLabel(w)}</span>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                        </div>
                      </div>
                      {targetOptions.length === 0 && (
                        <p className="mt-2 text-[12px] text-muted-foreground">{t('workspace.migrate.target.noneAvailable')}</p>
                      )}
                    </section>

                    <Separator />

                    {/* Entities */}
                    <section>
                      <div className="mb-2.5 flex items-center gap-1.5">
                        <SparklesIcon className="size-3.5 text-muted-foreground" />
                        <h3 className="text-[13px] font-medium text-foreground">{t('workspace.migrate.entities.label')}</h3>
                        <span className="text-[12px] text-muted-foreground">·</span>
                        <span className="text-[12px] text-muted-foreground">{t('workspace.migrate.entities.description')}</span>
                      </div>
                      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                        {ALL_ENTITIES.map((entity) => {
                          const meta = ENTITY_META[entity]
                          const Icon = meta.icon
                          const checked = entities.has(entity)
                          const count = entity === 'issues' && sourceStatusRows.length > 0 ? sourceStatusRows.length : null
                          return (
                            <label
                              key={entity}
                              data-testid={`migrate-entity-${entity}`}
                              className={cn(
                                'flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40',
                                checked && 'bg-foreground/[0.02]',
                              )}
                            >
                              <div
                                className={cn(
                                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                                  checked ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                                )}
                              >
                                <Icon className="size-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-medium text-foreground">{t(meta.labelKey)}</span>
                                  {count !== null && (
                                    <Badge variant="secondary" className="h-4 font-mono text-[9px]">{count}</Badge>
                                  )}
                                </div>
                                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{t(meta.descKey)}</p>
                              </div>
                              <Switch checked={checked} onCheckedChange={() => toggleEntity(entity)} size="sm" />
                            </label>
                          )
                        })}
                      </div>
                      {entities.size === 0 && (
                        <p className="mt-2 text-[12px] text-warning">{t('workspace.migrate.entities.none')}</p>
                      )}
                    </section>
                  </div>
                )}

                {/* Step 2 — Field mappings */}
                {step === 1 && (
                  !issuesSelected
                    ? (
                        <Empty className="py-16">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <SparklesIcon className="size-4" />
                            </EmptyMedia>
                            <EmptyTitle>{t('workspace.migrate.mappings.skippedTitle')}</EmptyTitle>
                            <EmptyDescription>{t('workspace.migrate.mappings.skippedBody')}</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )
                    : (
                        <div className="grid gap-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-[13px] font-medium text-foreground">{t('workspace.migrate.mappings.title')}</h3>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">{t('workspace.migrate.mappings.description')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => { setStatusMappings({}); setMilestoneMappings({}) }}
                              >
                                <RefreshIcon className="size-3.5" />
                                {t('workspace.migrate.mappings.auto')}
                              </Button>
                              <Separator orientation="vertical" className="h-5" />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
                                    {t('workspace.migrate.mappings.onlyUnmapped')}
                                    <Switch checked={onlyUnmapped} onCheckedChange={setOnlyUnmapped} size="sm" />
                                  </label>
                                </TooltipTrigger>
                                <TooltipContent side="top">{t('workspace.migrate.mappings.onlyUnmappedHint')}</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>

                          <Tabs defaultValue="statuses">
                            <TabsList>
                              <TabsTrigger value="statuses">
                                <span className="flex items-center gap-1.5">
                                  <ShuffleIcon className="size-3.5" />
                                  {t('workspace.migrate.mappings.tab.statuses')}
                                  {sourceStatusRows.length > 0 && <Badge variant="secondary" className="h-4 font-mono text-[9px]">{sourceStatusRows.length}</Badge>}
                                </span>
                              </TabsTrigger>
                              <TabsTrigger value="milestones">
                                <span className="flex items-center gap-1.5">
                                  <DotCircleIcon className="size-3.5" />
                                  {t('workspace.migrate.mappings.tab.milestones')}
                                  {sourceMilestoneRows.length > 0 && <Badge variant="secondary" className="h-4 font-mono text-[9px]">{sourceMilestoneRows.length}</Badge>}
                                </span>
                              </TabsTrigger>
                            </TabsList>

                            <TabsContent value="statuses" className="mt-3">
                              {sourceStatuses === undefined || targetStatuses === undefined
                                ? <SkeletonMappingTable t={t} />
                                : (
                                    <StatusMappingTable
                                      sourceStatuses={filterStatusRows(sourceStatusRows, statusMappings, targetStatusRows, onlyUnmapped)}
                                      targetStatuses={targetStatusRows}
                                      mappings={statusMappings}
                                      onMappingChange={handleStatusMapping}
                                      t={t}
                                    />
                                  )}
                            </TabsContent>
                            <TabsContent value="milestones" className="mt-3">
                              {sourceMilestones === undefined || targetMilestones === undefined
                                ? <SkeletonMappingTable t={t} />
                                : (
                                    <MilestoneMappingTable
                                      sourceMilestones={filterMilestoneRows(sourceMilestoneRows, milestoneMappings, targetMilestoneRows, onlyUnmapped)}
                                      targetMilestones={targetMilestoneRows}
                                      mappings={milestoneMappings}
                                      onMappingChange={handleMilestoneMapping}
                                      t={t}
                                    />
                                  )}
                            </TabsContent>
                          </Tabs>
                        </div>
                      )
                )}

                {/* Step 3 — Review */}
                {step === 2 && (
                  <div className="grid gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-medium text-foreground">{t('workspace.migrate.review.title')}</h3>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">{t('workspace.migrate.review.description')}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={migrating}
                        onClick={() => void runPreview()}
                      >
                        {previewing
                          ? <Spinner className="size-3.5" />
                          : preview
                            ? <RefreshIcon className="size-3.5" />
                            : <PlayIcon className="size-3.5" />}
                        {preview ? t('workspace.migrate.review.rerun') : t('workspace.migrate.review.runPreview')}
                      </Button>
                    </div>

                    {/* Route recap */}
                    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-[12px]">
                      <TruncatedText maxLines={1} className="font-medium text-foreground">{sourceWorkspace?.name ?? ''}</TruncatedText>
                      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <TruncatedText maxLines={1} className="font-medium text-foreground">{targetWorkspace?.name ?? ''}</TruncatedText>
                      <Separator orientation="vertical" className="mx-0.5 h-4" />
                      <div className="flex items-center gap-1.5">
                        {ALL_ENTITIES.filter(e => entities.has(e)).map(e => (
                          <Badge key={e} variant="outline" className="text-[10px] font-normal">
                            {t(ENTITY_META[e].labelKey)}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {!preview
                      ? (
                          <Empty className="py-12">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <PlayIcon className="size-4" />
                              </EmptyMedia>
                              <EmptyTitle>{t('workspace.migrate.review.notRunTitle')}</EmptyTitle>
                              <EmptyDescription>{t('workspace.migrate.review.notRunBody')}</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        )
                      : (
                          <PreviewSummary result={preview} targetName={targetWorkspace?.name ?? ''} t={t} />
                        )}
                  </div>
                )}
              </m.div>
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Footer */}
        <DialogFooter variant="bare" className="justify-between border-t border-border px-7 py-3.5">
          <div>
            {step === 0
              ? (
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={migrating}>
                    {t('workspace.migrate.action.cancel')}
                  </Button>
                )
              : (
                  <Button type="button" variant="ghost" onClick={() => setStep(s => (s - 1) as Step)} disabled={migrating}>
                    <ArrowLeftIcon className="size-3.5" />
                    {t('workspace.migrate.action.back')}
                  </Button>
                )}
          </div>
          <div className="flex items-center gap-3">
            {step < 2
              ? (
                  <Button
                    type="button"
                    disabled={step === 0 && !canNextFromDestinations}
                    onClick={() => setStep(s => (s + 1) as Step)}
                  >
                    {t('workspace.migrate.action.next')}
                    <ArrowRightIcon className="size-3.5" />
                  </Button>
                )
              : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!preview || migrating}
                        onClick={() => void runMigrate()}
                      >
                        {migrating
                          ? <LoadingLine className="animate-spin" />
                          : <TransferIcon className="size-4" />}
                        {migrating ? t('workspace.migrate.action.migrating') : t('workspace.migrate.action.migrate')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <span className="flex items-center gap-1.5">
                        {t('workspace.migrate.action.migrate')}
                        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘↵</kbd>
                      </span>
                    </TooltipContent>
                  </Tooltip>
                )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Filter helpers ─────────────────────────────────────── */

/**
 * When `onlyUnmapped` is on, hide source rows that already auto-match by name
 * on the target (they need no attention). Explicit overrides always stay visible.
 */
function filterStatusRows(
  source: StatusRow[],
  mappings: Record<string, string>,
  target: StatusRow[],
  onlyUnmapped: boolean,
): StatusRow[] {
  if (!onlyUnmapped) {
    return source
  }
  const targetNames = new Set(target.map(r => r.name.toLowerCase()))
  return source.filter((r) => {
    if (mappings[r.name] !== undefined) {
      return true
    }
    return !targetNames.has(r.name.toLowerCase())
  })
}

function filterMilestoneRows(
  source: MilestoneRow[],
  mappings: Record<string, string>,
  target: MilestoneRow[],
  onlyUnmapped: boolean,
): MilestoneRow[] {
  if (!onlyUnmapped) {
    return source
  }
  const targetTitles = new Set(target.map(r => r.title.toLowerCase()))
  return source.filter((r) => {
    if (mappings[r.title] !== undefined) {
      return true
    }
    return !targetTitles.has(r.title.toLowerCase())
  })
}
