import {
  DeleteLine as TrashIcon,
  GitBranchLine as GitBranchIcon,
  PlusLine as PlusIcon,
  RightSmallLine as ChevronRightIcon,
  SafeShieldLine as ShieldCheckIcon,
  SandglassLine as HourglassIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import type { Workspace } from '~/features/workspace/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { client } from '~/lib/client.config'
import { cn } from '~/lib/cn'

import { SettingsGroup, SettingsPage } from './settings-container'

const HOW_IT_WORKS_STEPS = [
  'await.guide.step.scope',
  'await.guide.step.match',
  'await.guide.step.apply',
] as const

const PATTERN_EXAMPLES: Array<{ pattern: string, descriptionKey: 'await.guide.pattern.example1.desc' | 'await.guide.pattern.example2.desc' | 'await.guide.pattern.example3.desc' | 'await.guide.pattern.example4.desc' }> = [
  { pattern: 'PR Checklist*', descriptionKey: 'await.guide.pattern.example1.desc' },
  { pattern: 'lint:*', descriptionKey: 'await.guide.pattern.example2.desc' },
  { pattern: 'snapshot', descriptionKey: 'await.guide.pattern.example3.desc' },
  { pattern: 'ci/?', descriptionKey: 'await.guide.pattern.example4.desc' },
]

// ── Types ──

interface BypassRule {
  id: string
  workspaceId: string
  repo: string
  checkPattern: string
  enabled: number
  createdAt: number
}

interface AvailableCheck {
  name: string
  required: boolean
  source: 'check-run' | 'status'
}

interface AvailableChecksResponse {
  owner: string
  repo: string
  defaultBranch: string
  checks: AvailableCheck[]
}

// ── Utils ──

function globMatch(name: string, pattern: string): boolean {
  const regexStr = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  return new RegExp(regexStr).test(name)
}

function parseRepoFullName(fullName: string): { owner: string, repo: string } | null {
  const parts = fullName.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) { return null }
  return { owner: parts[0], repo: parts[1] }
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage
    }
  }
  return fallback
}

// ── Hooks ──

function useBypassRuleMutations(workspaceId: string) {
  const queryClient = useQueryClient()
  const qk = ['bypass-rules', workspaceId]

  const create = useMutation({
    mutationFn: async ({ repo, checkPattern }: { repo: string, checkPattern: string }) => {
      const { data } = await client.post<BypassRule>({
        url: '/session-awaits/bypass-rules',
        body: { workspaceId, repo, checkPattern },
      })
      return data
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk }),
    onError: () => toastManager.add({ type: 'error', title: 'Failed to create bypass rule' }),
  })

  const remove = useMutation({
    mutationFn: async (ruleId: string) => {
      await client.delete({ url: `/session-awaits/bypass-rules/${ruleId}` })
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk }),
    onError: () => toastManager.add({ type: 'error', title: 'Failed to delete bypass rule' }),
  })

  const toggle = useMutation({
    mutationFn: async ({ ruleId, enabled }: { ruleId: string, enabled: boolean }) => {
      const { data } = await client.patch<BypassRule>({
        url: `/session-awaits/bypass-rules/${ruleId}`,
        body: { enabled },
      })
      return data
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk }),
  })

  return { create, remove, toggle }
}

// ── Sub-components ──

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-5 text-center">
      <ShieldCheckIcon className="size-4 !text-muted-foreground/40" />
      <span className="text-[11px] text-muted-foreground/70">{message}</span>
    </div>
  )
}

function CheckRow({ name, required, isBypassed, onToggle, isPending }: {
  name: string
  required: boolean
  isBypassed: boolean
  onToggle: () => void
  isPending: boolean
}) {
  const isToggleDisabled = isPending || required
  return (
    <div className={cn(
      'group flex items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors',
      isBypassed ? 'border-border bg-background' : 'border-border/50 bg-muted/20',
    )}
    >
      <Switch
        checked={isBypassed}
        onCheckedChange={onToggle}
        disabled={isToggleDisabled}
        className="scale-75 origin-left"
      />
      <div className="flex flex-1 min-w-0 items-center gap-2">
        <span className="text-[11px] font-mono text-foreground/80 truncate">{name}</span>
      </div>
      <span className={cn(
        'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium',
        required
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : 'bg-muted/40 text-muted-foreground/50',
      )}
      >
        {required ? 'req' : 'opt'}
      </span>
      {isPending && <Spinner className="size-3 !text-muted-foreground/50" />}
    </div>
  )
}

function DiscoveredRepoSection({ repoFullName, rules, createMut, removeMut }: {
  repoFullName: string
  rules: BypassRule[]
  createMut: ReturnType<typeof useBypassRuleMutations>['create']
  removeMut: ReturnType<typeof useBypassRuleMutations>['remove']
}) {
  const parsed = parseRepoFullName(repoFullName)
  const checkOwner = parsed?.owner ?? ''
  const checkRepo = parsed?.repo ?? ''
  const { data: checksData, isPending, error } = useQuery({
    queryKey: ['available-checks', checkOwner, checkRepo],
    queryFn: async () => {
      const { data } = await client.get<AvailableChecksResponse>({
        url: '/session-awaits/available-checks',
        query: { owner: checkOwner, repo: checkRepo },
      })
      return data
    },
    enabled: !!checkOwner && !!checkRepo,
    staleTime: 5 * 60 * 1000,
  })
  const [expanded, setExpanded] = useState(true)

  function findMatchingRule(checkName: string): BypassRule | undefined {
    return rules.find(r => r.enabled === 1 && globMatch(checkName, r.checkPattern))
  }

  function handleToggle(check: AvailableCheck) {
    if (check.required) {
      return
    }
    const existing = findMatchingRule(check.name)
    if (existing) {
      removeMut.mutate(existing.id)
    }
    else {
      createMut.mutate({ repo: repoFullName, checkPattern: check.name })
    }
  }

  const checks = checksData?.checks ?? []
  const bypassedCount = checks.filter(c => findMatchingRule(c.name)).length
  const manualOnlyRules = rules.filter(r => !checks.some(c => globMatch(c.name, r.checkPattern)))

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRightIcon className={cn('size-3 !text-muted-foreground/50 transition-transform', expanded && 'rotate-90')} />
        <GitBranchIcon className="size-3 !text-muted-foreground/50" />
        <span className="text-[11px] font-medium text-foreground/80 font-mono">{repoFullName}</span>
        {checks.length > 0 && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums ml-auto">
            {bypassedCount > 0 ? `${bypassedCount}/${checks.length} bypassed` : `${checks.length} checks`}
          </span>
        )}
      </button>

      {expanded && (
        <div className="flex flex-col gap-1 pl-5">
          {isPending && (
            <div className="flex items-center justify-center py-3">
              <Spinner className="size-3.5 !text-muted-foreground/50" />
            </div>
          )}

          {error && (
            <div className="text-[11px] text-destructive/70 py-2 px-3">
              {readErrorMessage(error, 'Failed to fetch checks. Existing rules still apply.')}
            </div>
          )}

          {!isPending && !error && checks.length === 0 && (
            <span className="text-[11px] text-muted-foreground/50 py-2 px-3">No CI checks found.</span>
          )}

          {checks.map((check) => {
            const matchingRule = findMatchingRule(check.name)
            return (
              <CheckRow
                key={check.name}
                name={check.name}
                required={check.required}
                isBypassed={!!matchingRule}
                onToggle={() => handleToggle(check)}
                isPending={createMut.isPending || removeMut.isPending}
              />
            )
          })}

          {/* Manual rules for this repo that don't match any discovered check */}
          {manualOnlyRules.map(rule => (
            <div key={rule.id} className="group flex items-center gap-2.5 rounded-md border border-dashed border-border/50 px-3 py-1.5 bg-muted/10">
              <Switch
                checked={rule.enabled === 1}
                onCheckedChange={() => removeMut.mutate(rule.id)}
                className="scale-75 origin-left"
              />
              <span className="text-[11px] font-mono text-foreground/60 truncate flex-1">{rule.checkPattern}</span>
              <span className="shrink-0 rounded bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground/40">manual</span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                onClick={() => removeMut.mutate(rule.id)}
              >
                <TrashIcon className="size-3 !text-muted-foreground/50" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ManualRuleCard({ rule, onToggle, onDelete }: { rule: BypassRule, onToggle: (enabled: boolean) => void, onDelete: () => void }) {
  return (
    <div className={cn(
      'group flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors',
      rule.enabled === 1 ? 'border-border bg-background' : 'border-border/50 bg-muted/30 opacity-60',
    )}
    >
      <Switch
        checked={rule.enabled === 1}
        onCheckedChange={onToggle}
        className="scale-75 origin-left"
      />
      <div className="flex flex-1 min-w-0 items-center gap-2">
        <GitBranchIcon className="size-3 shrink-0 !text-muted-foreground/50" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-foreground/80 truncate block">{rule.repo}</span>
          <span className="text-[10px] text-muted-foreground truncate block font-mono">{rule.checkPattern}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Delete rule"
      >
        <TrashIcon className="size-3 !text-muted-foreground/50" />
      </Button>
    </div>
  )
}

function AddRuleForm({ onSubmit, onCancel, isPending }: {
  onSubmit: (repo: string, pattern: string) => void
  onCancel: () => void
  isPending: boolean
}) {
  const { t } = useTranslation('settings')
  const [repo, setRepo] = useState('')
  const [pattern, setPattern] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!repo.trim() || !pattern.trim()) { return }
    onSubmit(repo.trim(), pattern.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <Input
        placeholder="owner/repo"
        value={repo}
        onChange={e => setRepo(e.target.value)}
        className="h-7 text-xs"
        autoFocus
      />
      <Input
        placeholder={t('await.rules.patternPlaceholder')}
        value={pattern}
        onChange={e => setPattern(e.target.value)}
        className="h-7 text-xs font-mono"
      />
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="xs" disabled={isPending || !repo.trim() || !pattern.trim()}>
          {isPending && <Spinner className="size-3 mr-1" />}
          Add
        </Button>
      </div>
    </form>
  )
}

// ── Per-workspace section ──

const WorkspaceBypassSection = ({ workspace }: { workspace: Workspace }) => {
  const { t } = useTranslation('settings')
  const { data: rules = [], isPending: rulesPending } = useQuery({
    queryKey: ['bypass-rules', workspace.id],
    queryFn: async () => {
      const { data } = await client.get<BypassRule[]>({
        url: '/session-awaits/bypass-rules',
        query: { workspaceId: workspace.id },
      })
      return data ?? []
    },
  })
  const { data: discoveredRepos = [], isPending: reposPending } = useQuery({
    queryKey: ['discovered-repos', workspace.id],
    queryFn: async () => {
      const { data } = await client.get<string[]>({
        url: '/session-awaits/discovered-repos',
        query: { workspaceId: workspace.id },
      })
      return data ?? []
    },
  })
  const { create, remove, toggle } = useBypassRuleMutations(workspace.id)
  const [showAdd, setShowAdd] = useState(false)

  const handleAdd = (repo: string, pattern: string) => {
    create.mutate(
      { repo, checkPattern: pattern },
      { onSuccess: () => setShowAdd(false) },
    )
  }

  const discoveredSet = new Set(discoveredRepos)
  const unmatchedRules = rules.filter(r => !discoveredSet.has(r.repo))

  const isInitialLoading = rulesPending || reposPending
  const totalRules = rules.length

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
            {workspace.name.charAt(0).toUpperCase()}
          </span>
          <h3 className="text-xs font-medium text-foreground/90">{workspace.name}</h3>
        </div>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {totalRules > 0 ? `${totalRules} rule${totalRules !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {isInitialLoading && (
        <div className="flex items-center justify-center py-4">
          <Spinner className="size-3.5 !text-muted-foreground/50" />
        </div>
      )}

      {!isInitialLoading && discoveredRepos.length === 0 && unmatchedRules.length === 0 && !showAdd && (
        <EmptyState message={t('await.rules.empty')} />
      )}

      {/* Discovered repos */}
      {!reposPending && discoveredRepos.length > 0 && (
        <div className="flex flex-col gap-2">
          {discoveredRepos.map(repo => (
            <DiscoveredRepoSection
              key={repo}
              repoFullName={repo}
              rules={rules.filter(r => r.repo === repo)}
              createMut={create}
              removeMut={remove}
            />
          ))}
        </div>
      )}

      {/* Unmatched manual rules */}
      {!rulesPending && unmatchedRules.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {discoveredRepos.length > 0 && (
            <span className="text-[10px] text-muted-foreground/50 mt-1">Manual rules</span>
          )}
          {unmatchedRules.map(rule => (
            <ManualRuleCard
              key={rule.id}
              rule={rule}
              onToggle={enabled => toggle.mutate({ ruleId: rule.id, enabled })}
              onDelete={() => remove.mutate(rule.id)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddRuleForm
          onSubmit={handleAdd}
          onCancel={() => setShowAdd(false)}
          isPending={create.isPending}
        />
      )}

      {!showAdd && (
        <Button variant="ghost" size="xs" className="self-start text-muted-foreground hover:text-foreground" onClick={() => setShowAdd(true)}>
          <PlusIcon className="size-3 mr-1" />
          {t('await.rules.add')}
        </Button>
      )}
    </div>
  )
}

// ── Guide ──

function AwaitGuide() {
  const { t } = useTranslation('settings')
  return (
    <SettingsGroup
      label={t('await.guide.label')}
      description={t('await.guide.description')}
      bare
      className="overflow-hidden"
      data-testid="await-guide"
    >
      <div className="flex gap-3 p-4">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <HourglassIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">
            {t('await.guide.intro.title')}
          </h3>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground text-pretty">
            {t('await.guide.intro.body')}
          </p>
        </div>
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <h4 className="text-[12px] font-medium text-foreground/90">
          {t('await.guide.bypass.title')}
        </h4>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground text-pretty">
          {t('await.guide.bypass.body')}
        </p>
        <ol className="mt-3 grid gap-2">
          {HOW_IT_WORKS_STEPS.map((stepKey, index) => (
            <li
              key={stepKey}
              className="grid grid-cols-[auto_1fr] gap-2 text-[12px] leading-5 text-muted-foreground"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="text-pretty">{t(stepKey)}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <h4 className="text-[12px] font-medium text-foreground/90">
          {t('await.guide.patterns.title')}
        </h4>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground text-pretty">
          {t('await.guide.patterns.note')}
        </p>
        <ul className="mt-2 grid gap-1.5">
          {PATTERN_EXAMPLES.map(({ pattern, descriptionKey }) => (
            <li
              key={pattern}
              className="grid grid-cols-[auto_1fr] items-baseline gap-2 text-[12px]"
            >
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90">
                {pattern}
              </code>
              <span className="text-muted-foreground text-pretty">{t(descriptionKey)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border/60 bg-muted/30 px-4 py-3">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <ShieldCheckIcon
            className="mt-0.5 size-3.5 shrink-0 !text-amber-700 dark:!text-amber-300"
            aria-hidden="true"
          />
          <p className="text-[12px] leading-5 text-muted-foreground text-pretty">
            <span className="font-medium text-foreground">
              {t('await.guide.scope.title')}
            </span>
            {' '}
            {t('await.guide.scope.description')}
          </p>
        </div>
      </div>
    </SettingsGroup>
  )
}

// ── Page ──

export function AwaitSettings() {
  const { t } = useTranslation('settings')
  const { workspaces, ready } = useWorkspaces()

  if (!ready) { return null }

  return (
    <SettingsPage
      title={t('await.page.title')}
      description={t('await.page.description')}
      data-testid="await-settings"
    >
      <AwaitGuide />
      <div className="flex flex-col gap-3">
        {workspaces.map(w => (
          <WorkspaceBypassSection key={w.id} workspace={w} />
        ))}
      </div>
    </SettingsPage>
  )
}
