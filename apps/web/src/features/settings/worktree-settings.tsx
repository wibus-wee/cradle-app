import {
  DeleteLine as TrashIcon,
  GitBranchLine as GitBranchIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '~/components/ui/number-field'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import type { AppPreferences } from './use-app-preferences'
import { useAppPreferences } from './use-app-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface ManagedWorktree {
  id: string
  sourceWorkspaceId: string
  workspaceName: string
  name: string
  path: string
  branch: string
  baseRef: string
  status: 'active' | 'merged' | 'abandoned'
  createdBySessionId: string | null
  createdAt: number
  updatedAt: number
  sizeBytes: number
  sessionCount: number
}

interface ManagedWorktreeListResponse {
  worktrees: ManagedWorktree[]
  totalSizeBytes: number
}

interface CleanupResponse {
  cleaned: ManagedWorktree[]
  skipped: number
  totalSizeBytes: number
}

const MANAGED_WORKTREES_QUERY_KEY = ['managed-worktrees']

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000))
}

function clampNumber(value: number | null | undefined, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return min
  }
  return Math.min(Math.max(Math.round(value), min), max)
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, getServerUrl()), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return await response.json() as T
}

function useManagedWorktrees() {
  return useQuery({
    queryKey: MANAGED_WORKTREES_QUERY_KEY,
    queryFn: () => requestJson<ManagedWorktreeListResponse>('/worktrees/managed'),
  })
}

function useCleanupWorktree() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (worktree: ManagedWorktree) => requestJson<{ ok: true }>(
      `/workspaces/${encodeURIComponent(worktree.sourceWorkspaceId)}/worktrees/${encodeURIComponent(worktree.id)}/cleanup`,
      {
        method: 'POST',
        body: JSON.stringify({ mode: 'abandon' }),
      },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MANAGED_WORKTREES_QUERY_KEY })
    },
  })
}

function useCleanupPolicy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (policy: AppPreferences['worktreeCleanup']) => requestJson<CleanupResponse>('/worktrees/cleanup', {
      method: 'POST',
      body: JSON.stringify(policy),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MANAGED_WORKTREES_QUERY_KEY })
    },
  })
}

interface RetentionNumberFieldProps {
  value: number
  min: number
  max: number
  disabled: boolean
  label: string
  onChange: (value: number) => void
}

function RetentionNumberField({ value, min, max, disabled, label, onChange }: RetentionNumberFieldProps) {
  return (
    <NumberField
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onValueChange={nextValue => onChange(clampNumber(nextValue, min, max))}
      size="sm"
      className="w-32"
    >
      <NumberFieldGroup>
        <NumberFieldDecrement />
        <NumberFieldInput aria-label={label} />
        <NumberFieldIncrement />
      </NumberFieldGroup>
    </NumberField>
  )
}

interface WorktreeRowProps {
  worktree: ManagedWorktree
  busy: boolean
  onCleanup: (worktree: ManagedWorktree) => void
}

function WorktreeRow({ worktree, busy, onCleanup }: WorktreeRowProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/60 px-4 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranchIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-[13px] font-medium text-foreground">{worktree.name}</span>
          <Badge variant="outline">{formatBytes(worktree.sizeBytes)}</Badge>
          {worktree.sessionCount > 0 && (
            <Badge variant="secondary">
              {t('worktrees.list.boundSessions', { count: worktree.sessionCount })}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <span className="truncate">{worktree.workspaceName}</span>
          <span aria-hidden="true">/</span>
          <span className="truncate font-mono">{worktree.branch}</span>
          <span aria-hidden="true">/</span>
          <span>{t('worktrees.list.createdAt', { value: formatDate(worktree.createdAt) })}</span>
        </div>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">{worktree.path}</p>
      </div>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={busy}
        onClick={() => onCleanup(worktree)}
      >
        {busy ? <Spinner className="size-3.5" /> : <TrashIcon className="size-3.5" />}
        {t('worktrees.action.cleanupOne' as SettingsKey)}
      </Button>
    </div>
  )
}

export function WorktreeSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isLoading: prefsLoading, savePrefs, isSaving } = useAppPreferences()
  const worktreesQuery = useManagedWorktrees()
  const cleanupOne = useCleanupWorktree()
  const cleanupPolicy = useCleanupPolicy()
  const [confirmWorktree, setConfirmWorktree] = useState<ManagedWorktree | null>(null)

  const worktrees = worktreesQuery.data?.worktrees ?? []
  const totalSizeBytes = worktreesQuery.data?.totalSizeBytes ?? 0
  const sortedWorktrees = useMemo(
    () => [...worktrees].sort((left, right) => right.createdAt - left.createdAt),
    [worktrees],
  )

  const policy = prefs?.worktreeCleanup ?? { maxWorktrees: 25, maxTotalSizeGb: 50 }
  const cleanupBusy = cleanupOne.isPending || cleanupPolicy.isPending

  const saveCleanupPolicy = (patch: Partial<AppPreferences['worktreeCleanup']>) => {
    if (!prefs) {
      return
    }
    void savePrefs({
      worktreeCleanup: {
        ...prefs.worktreeCleanup,
        ...patch,
      },
    })
  }

  const handleConfirmCleanup = () => {
    if (!confirmWorktree) {
      return
    }
    cleanupOne.mutate(confirmWorktree, {
      onSettled: () => setConfirmWorktree(null),
    })
  }

  return (
    <SettingsPage
      title={t('worktrees.page.title' as SettingsKey)}
      description={t('worktrees.page.description' as SettingsKey)}
      maxWidth="4xl"
    >
      <SettingsGroup
        label={t('worktrees.cleanup.title' as SettingsKey)}
        description={t('worktrees.cleanup.description' as SettingsKey)}
        action={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!prefs || cleanupBusy || prefsLoading}
            onClick={() => cleanupPolicy.mutate(policy)}
          >
            {cleanupPolicy.isPending ? <Spinner className="size-3.5" /> : <RefreshIcon className="size-3.5" />}
            {t('worktrees.action.runCleanup' as SettingsKey)}
          </Button>
        )}
      >
        <SettingsRow
          label={t('worktrees.cleanup.maxWorktrees.label' as SettingsKey)}
          description={t('worktrees.cleanup.maxWorktrees.description' as SettingsKey)}
        >
          <RetentionNumberField
            value={policy.maxWorktrees}
            min={0}
            max={250}
            disabled={!prefs || isSaving || prefsLoading}
            label={t('worktrees.cleanup.maxWorktrees.label' as SettingsKey)}
            onChange={value => saveCleanupPolicy({ maxWorktrees: value })}
          />
        </SettingsRow>
        <SettingsRow
          label={t('worktrees.cleanup.maxTotalSizeGb.label' as SettingsKey)}
          description={t('worktrees.cleanup.maxTotalSizeGb.description' as SettingsKey)}
        >
          <RetentionNumberField
            value={policy.maxTotalSizeGb}
            min={0}
            max={1000}
            disabled={!prefs || isSaving || prefsLoading}
            label={t('worktrees.cleanup.maxTotalSizeGb.label' as SettingsKey)}
            onChange={value => saveCleanupPolicy({ maxTotalSizeGb: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        label={t('worktrees.list.title' as SettingsKey)}
        description={t('worktrees.list.description', {
          count: worktrees.length,
          size: formatBytes(totalSizeBytes),
        })}
        bare
      >
        {worktreesQuery.isLoading
          ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('worktrees.list.loading' as SettingsKey)}
            </div>
          )
          : worktreesQuery.isError
            ? (
              <div className="px-4 py-6 text-xs text-destructive">
                {t('worktrees.list.error' as SettingsKey)}
              </div>
            )
            : sortedWorktrees.length === 0
              ? (
                <Empty className="min-h-32 border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <GitBranchIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t('worktrees.empty.title' as SettingsKey)}</EmptyTitle>
                    <EmptyDescription>{t('worktrees.empty.description' as SettingsKey)}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
              : (
                <div className={cn('divide-y-0', cleanupBusy && 'opacity-80')}>
                  {sortedWorktrees.map(worktree => (
                    <WorktreeRow
                      key={worktree.id}
                      worktree={worktree}
                      busy={cleanupOne.isPending && cleanupOne.variables?.id === worktree.id}
                      onCleanup={setConfirmWorktree}
                    />
                  ))}
                </div>
              )}
      </SettingsGroup>

      <AlertDialog open={confirmWorktree !== null} onOpenChange={open => !open && setConfirmWorktree(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('worktrees.confirm.title' as SettingsKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('worktrees.confirm.description', { name: confirmWorktree?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('worktrees.confirm.cancel' as SettingsKey)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmCleanup}
            >
              {t('worktrees.confirm.action' as SettingsKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
