import type { TFunction } from 'i18next'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { ThinkingEffort } from '~/features/composer-toolbar/types'

import type { CreateAutomationInput } from './types'

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export interface ScheduleDraft {
  frequency: ScheduleFrequency
  interval: number
  weekdays: Weekday[]
  monthDay: number
  time: string
}

export interface CreateAutomationDraft {
  title: string
  description: string
  workspaceId: string | null
  enabled: boolean
  schedule: ScheduleDraft
  timezone: string
  misfirePolicy: 'skip' | 'run_latest'
  providerTargetId: string
  runtimeKind: RuntimeKind
  modelId: string | null
  thinkingEffort: ThinkingEffort
  sessionPolicy: 'new' | 'heartbeat'
  isolationPolicy: 'workspace' | 'worktree_per_run'
  noFindingsBehavior: 'archive' | 'triage'
  prompt: string
  artifactName: string
}

export const WEEKDAY_OPTIONS: Weekday[] = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
]

export const DEFAULT_SCHEDULE: ScheduleDraft = {
  frequency: 'weekly',
  interval: 1,
  weekdays: ['MO'],
  monthDay: 1,
  time: '09:00',
}

const FREQUENCY_TO_RRULE: Record<ScheduleFrequency, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
}

export function createDefaultAutomationDraft(
  providerTargetId = '',
  workspaceId: string | null = null,
  runtimeKind: RuntimeKind = '',
): CreateAutomationDraft {
  return {
    title: '',
    description: '',
    workspaceId,
    enabled: true,
    schedule: DEFAULT_SCHEDULE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    misfirePolicy: 'run_latest',
    providerTargetId,
    runtimeKind,
    modelId: null,
    thinkingEffort: null,
    sessionPolicy: 'new',
    isolationPolicy: 'workspace',
    noFindingsBehavior: 'archive',
    prompt: '',
    artifactName: 'automation-run.md',
  }
}

export function clampScheduleNumber(
  value: number,
  min: number,
  max: number,
): number {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function parseRruleToSchedule(rrule: string): ScheduleDraft {
  const parts = Object.fromEntries(rrule.split(';').map(part => part.split('=')))
  const frequency: ScheduleFrequency = parts.FREQ === 'DAILY'
    ? 'daily'
    : parts.FREQ === 'MONTHLY'
      ? 'monthly'
      : 'weekly'
  const interval = clampScheduleNumber(Number(parts.INTERVAL ?? 1), 1, 99)
  const weekdays = parts.BYDAY
    ? parts.BYDAY.split(',') as Weekday[]
    : DEFAULT_SCHEDULE.weekdays
  const monthDay = clampScheduleNumber(Number(parts.BYMONTHDAY ?? 1), 1, 31)
  const hour = clampScheduleNumber(Number(parts.BYHOUR ?? 9), 0, 23)
  const minute = clampScheduleNumber(Number(parts.BYMINUTE ?? 0), 0, 59)

  return {
    frequency,
    interval,
    weekdays,
    monthDay,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}

export function buildScheduleRrule(schedule: ScheduleDraft): string {
  const [hourInput, minuteInput] = schedule.time.split(':')
  const hour = clampScheduleNumber(Number(hourInput), 0, 23)
  const minute = clampScheduleNumber(Number(minuteInput), 0, 59)
  const parts = [
    `FREQ=${FREQUENCY_TO_RRULE[schedule.frequency]}`,
    `INTERVAL=${clampScheduleNumber(schedule.interval, 1, 99)}`,
  ]

  if (schedule.frequency === 'weekly') {
    parts.push(
      `BYDAY=${(schedule.weekdays.length > 0
        ? schedule.weekdays
        : DEFAULT_SCHEDULE.weekdays).join(',')}`,
    )
  }
  if (schedule.frequency === 'monthly') {
    parts.push(
      `BYMONTHDAY=${clampScheduleNumber(schedule.monthDay, 1, 31)}`,
    )
  }
  parts.push(`BYHOUR=${hour}`, `BYMINUTE=${minute}`, 'BYSECOND=0')
  return parts.join(';')
}

export function formatScheduleSummary(
  schedule: ScheduleDraft,
  t: TFunction<'automation'>,
): string {
  const interval = clampScheduleNumber(schedule.interval, 1, 99)
  const time = schedule.time

  if (schedule.frequency === 'daily') {
    return interval === 1
      ? t('schedule.summary.daily', { time })
      : t('schedule.summary.dailyInterval', { count: interval, time })
  }
  if (schedule.frequency === 'weekly') {
    const days = (schedule.weekdays.length > 0
      ? schedule.weekdays
      : DEFAULT_SCHEDULE.weekdays)
      .map(day => t(`schedule.weekday.${day}`))
      .join(t('list.separator'))
    return interval === 1
      ? t('schedule.summary.weekly', { days, time })
      : t('schedule.summary.weeklyInterval', { count: interval, days, time })
  }
  return interval === 1
    ? t('schedule.summary.monthly', {
        day: clampScheduleNumber(schedule.monthDay, 1, 31),
        time,
      })
    : t('schedule.summary.monthlyInterval', {
        count: interval,
        day: clampScheduleNumber(schedule.monthDay, 1, 31),
        time,
      })
}

export function toCreateAutomationInput(
  draft: CreateAutomationDraft,
  t: TFunction<'automation'>,
): CreateAutomationInput {
  const title = draft.title.trim()
  const prompt = draft.prompt.trim()
  const providerTargetId = draft.providerTargetId.trim()
  const artifactName = draft.artifactName.trim()

  if (!title) {
    throw new Error(t('validation.titleRequired'))
  }
  if (!draft.timezone.trim()) {
    throw new Error(t('validation.timezoneRequired'))
  }
  if (!providerTargetId) {
    throw new Error(t('validation.providerTargetRequired'))
  }
  if (!draft.modelId) {
    throw new Error(t('validation.modelRequired'))
  }
  if (!prompt) {
    throw new Error(t('validation.promptRequired'))
  }
  if (!artifactName) {
    throw new Error(t('validation.artifactNameRequired'))
  }

  return {
    title,
    description: draft.description.trim(),
    workspaceId: draft.workspaceId,
    enabled: draft.enabled,
    trigger: {
      type: 'rrule',
      rrule: buildScheduleRrule(draft.schedule),
      timezone: draft.timezone.trim(),
      misfirePolicy: draft.misfirePolicy,
    },
    recipe: {
      kind: 'agent_task',
      prompt,
      inputs: [],
      artifactRequests: [{ kind: 'markdown', name: artifactName }],
      providerTargetId,
      runtimeKind: draft.runtimeKind,
      modelId: draft.modelId,
      thinkingEffort: draft.thinkingEffort ?? undefined,
      sessionPolicy: draft.sessionPolicy,
      isolationPolicy: draft.isolationPolicy,
      completionPolicy: {
        stopWhen: 'agent_complete',
        noFindingsBehavior: draft.noFindingsBehavior,
      },
    },
    createdByKind: 'user',
  }
}
