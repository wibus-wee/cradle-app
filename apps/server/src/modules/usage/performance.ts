import { backendRunSnapshotEvents, backendRunSnapshots, providerTargets } from '@cradle/db'
import { sql } from 'drizzle-orm'

import { db } from '../../infra'
import { resolveTimeRange } from './service'

export interface RuntimePerformanceMetrics {
  sampleCount: number
  firstTokenSampleCount: number
  p50FirstTokenMs: number | null
  p95FirstTokenMs: number | null
  p50TotalDurationMs: number | null
  p95TotalDurationMs: number | null
}

export interface RuntimePerformanceOverview {
  coverageStartedAt: number | null
  coverageEndedAt: number | null
  summary: RuntimePerformanceMetrics
  byRuntime: Array<RuntimePerformanceMetrics & { runtimeKind: string }>
  byProviderTarget: Array<RuntimePerformanceMetrics & {
    providerTargetId: string | null
    providerTargetName: string | null
  }>
  byModel: Array<RuntimePerformanceMetrics & { modelId: string }>
  daily: Array<RuntimePerformanceMetrics & { date: string, runtimeKind: string }>
}

interface RuntimePerformanceRow {
  date: string
  runtime_kind: string
  provider_target_id: string | null
  provider_target_name: string | null
  model_id: string | null
  started_at: number
  completed_at: number
  first_token_at: number | null
}

interface RuntimePerformanceSample {
  date: string
  runtimeKind: string
  providerTargetId: string | null
  providerTargetName: string | null
  modelId: string
  startedAt: number
  completedAt: number
  firstTokenMs: number | null
  totalDurationMs: number
}

export function getRuntimePerformanceOverview(
  from?: string,
  to?: string,
): RuntimePerformanceOverview {
  const { fromEpoch, toEpoch } = resolveTimeRange(from, to)
  const rows = db().all<RuntimePerformanceRow>(sql`
    SELECT
      date(${backendRunSnapshots.startedAt} / 1000, 'unixepoch', 'localtime') AS date,
      ${backendRunSnapshots.runtimeKind} AS runtime_kind,
      ${backendRunSnapshots.providerTargetId} AS provider_target_id,
      ${providerTargets.displayName} AS provider_target_name,
      ${backendRunSnapshots.modelId} AS model_id,
      ${backendRunSnapshots.startedAt} AS started_at,
      ${backendRunSnapshots.completedAt} AS completed_at,
      MIN(
        CASE
          WHEN ${backendRunSnapshotEvents.phase} = 'model_first_token_delta'
          THEN ${backendRunSnapshotEvents.occurredAt}
          ELSE NULL
        END
      ) AS first_token_at
    FROM ${backendRunSnapshots}
    LEFT JOIN ${backendRunSnapshotEvents}
      ON ${backendRunSnapshotEvents.snapshotId} = ${backendRunSnapshots.id}
    LEFT JOIN ${providerTargets}
      ON ${providerTargets.id} = ${backendRunSnapshots.providerTargetId}
    WHERE ${backendRunSnapshots.status} = 'complete'
      AND ${backendRunSnapshots.completedAt} IS NOT NULL
      AND ${backendRunSnapshots.completedAt} >= ${backendRunSnapshots.startedAt}
      AND ${backendRunSnapshots.startedAt} >= ${fromEpoch * 1000}
      AND ${backendRunSnapshots.startedAt} < ${toEpoch * 1000}
    GROUP BY ${backendRunSnapshots.id}
    ORDER BY ${backendRunSnapshots.startedAt} ASC
  `)
  const samples = rows.map(toPerformanceSample)

  return {
    coverageStartedAt: samples.at(0)?.startedAt ?? null,
    coverageEndedAt: samples.length > 0
      ? Math.max(...samples.map(sample => sample.completedAt))
      : null,
    summary: summarizePerformanceSamples(samples),
    byRuntime: groupSamples(samples, sample => sample.runtimeKind)
      .map(([runtimeKind, grouped]) => ({
        runtimeKind,
        ...summarizePerformanceSamples(grouped),
      }))
      .sort(comparePerformanceGroups),
    byProviderTarget: groupSamples(
      samples,
      sample => `${sample.providerTargetId ?? ''}\u0000${sample.providerTargetName ?? ''}`,
    )
      .map(([key, grouped]) => {
        const [providerTargetId, providerTargetName] = key.split('\u0000')
        return {
          providerTargetId: providerTargetId || null,
          providerTargetName: providerTargetName || null,
          ...summarizePerformanceSamples(grouped),
        }
      })
      .sort(comparePerformanceGroups),
    byModel: groupSamples(samples, sample => sample.modelId)
      .map(([modelId, grouped]) => ({
        modelId,
        ...summarizePerformanceSamples(grouped),
      }))
      .sort(comparePerformanceGroups),
    daily: groupSamples(samples, sample => `${sample.date}\u0000${sample.runtimeKind}`)
      .map(([key, grouped]) => {
        const [date, runtimeKind] = key.split('\u0000')
        return {
          date: date!,
          runtimeKind: runtimeKind!,
          ...summarizePerformanceSamples(grouped),
        }
      })
      .sort((left, right) =>
        left.date.localeCompare(right.date)
        || left.runtimeKind.localeCompare(right.runtimeKind)),
  }
}

function toPerformanceSample(row: RuntimePerformanceRow): RuntimePerformanceSample {
  const firstTokenMs = row.first_token_at !== null
    && row.first_token_at >= row.started_at
    && row.first_token_at <= row.completed_at
    ? row.first_token_at - row.started_at
    : null
  return {
    date: row.date,
    runtimeKind: row.runtime_kind,
    providerTargetId: row.provider_target_id,
    providerTargetName: row.provider_target_name,
    modelId: row.model_id ?? 'unknown',
    startedAt: row.started_at,
    completedAt: row.completed_at,
    firstTokenMs,
    totalDurationMs: row.completed_at - row.started_at,
  }
}

function summarizePerformanceSamples(
  samples: RuntimePerformanceSample[],
): RuntimePerformanceMetrics {
  const firstTokenValues = samples
    .flatMap(sample => sample.firstTokenMs === null ? [] : [sample.firstTokenMs])
  const totalDurationValues = samples.map(sample => sample.totalDurationMs)
  return {
    sampleCount: samples.length,
    firstTokenSampleCount: firstTokenValues.length,
    p50FirstTokenMs: percentile(firstTokenValues, 0.5),
    p95FirstTokenMs: percentile(firstTokenValues, 0.95),
    p50TotalDurationMs: percentile(totalDurationValues, 0.5),
    p95TotalDurationMs: percentile(totalDurationValues, 0.95),
  }
}

function groupSamples(
  samples: RuntimePerformanceSample[],
  readKey: (sample: RuntimePerformanceSample) => string,
): Array<[string, RuntimePerformanceSample[]]> {
  const groups = new Map<string, RuntimePerformanceSample[]>()
  for (const sample of samples) {
    const key = readKey(sample)
    const group = groups.get(key)
    if (group) {
      group.push(sample)
    }
    else {
      groups.set(key, [sample])
    }
  }
  return [...groups.entries()]
}

function comparePerformanceGroups(
  left: RuntimePerformanceMetrics,
  right: RuntimePerformanceMetrics,
): number {
  return right.sampleCount - left.sampleCount
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * quantile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return Math.round(lower + (upper - lower) * (index - lowerIndex))
}
