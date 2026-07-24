import type { TFunction } from 'i18next'
import { z } from 'zod'

import type {
  AutomationDefinition,
  AutomationRecipe,
  AutomationRun,
  AutomationTrigger,
} from './types'

const UnixSecondsValueSchema = z.union([
  z.number().finite().transform(value =>
    value > 10_000_000_000 ? Math.floor(value / 1000) : value),
  z.string()
    .transform(value => Math.floor(Date.parse(value) / 1000))
    .pipe(z.number().finite()),
])
const UnixSecondsSchema = z.union([
  UnixSecondsValueSchema,
  z.null().transform(() => null),
  z.undefined().transform(() => null),
])
const RunTimeSortKeySchema = z.union([
  UnixSecondsValueSchema,
  z.null().transform(() => 0),
  z.undefined().transform(() => 0),
])

export function formatAutomationDateTime(
  value: number | string | null | undefined,
  locale: string,
  t: TFunction<'automation'>,
): string {
  const unixSeconds = UnixSecondsSchema.parse(value)
  if (unixSeconds === null) {
    return t('datetime.notRecorded')
  }
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

export function formatAutomationRelativeTime(
  value: number | string | null | undefined,
  t: TFunction<'automation'>,
  now = Date.now(),
): string {
  const unixSeconds = UnixSecondsSchema.parse(value)
  if (unixSeconds === null) {
    return t('datetime.notRecorded')
  }
  const diff = Math.floor(now / 1000) - unixSeconds
  if (diff < 60) {
    return t('relative.justNow')
  }
  if (diff < 3_600) {
    return t('relative.minute', { count: Math.floor(diff / 60) })
  }
  if (diff < 86_400) {
    return t('relative.hour', { count: Math.floor(diff / 3_600) })
  }
  return t('relative.day', { count: Math.floor(diff / 86_400) })
}

export function getAutomationTrigger(
  definition: AutomationDefinition,
): AutomationTrigger | null {
  return definition.trigger ?? definition.triggerJson ?? null
}

export function getAutomationRecipe(
  definition: AutomationDefinition,
): AutomationRecipe | null {
  return definition.recipe ?? definition.recipeJson ?? null
}

export function getAutomationRunTime(
  run: AutomationRun | null | undefined,
): number {
  return RunTimeSortKeySchema.parse(
    run?.createdAt ?? run?.startedAt ?? run?.scheduledFor,
  )
}

export function getLatestAutomationRun(
  definition: AutomationDefinition,
  runs: readonly AutomationRun[] | undefined,
): AutomationRun | null {
  if (definition.latestRun) {
    return definition.latestRun
  }
  if (!runs || runs.length === 0) {
    return null
  }
  return [...runs].sort(
    (left, right) =>
      getAutomationRunTime(right) - getAutomationRunTime(left),
  )[0] ?? null
}
