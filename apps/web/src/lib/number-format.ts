import { clamp } from 'es-toolkit'
import formatDuration from 'format-duration'
import prettyBytes from 'pretty-bytes'

export function clampRatio(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 0
}

export function clampPercentValue(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 100) : 0
}

export function boundedPercent(value: number | null, max: number): number {
  if (value === null || max <= 0) {
    return 0
  }
  return clampPercentValue((value / max) * 100)
}

export function formatPercentFromRatio(value: number): string {
  return `${Math.round(clampRatio(value) * 100)}%`
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    if (Number(thousands.toFixed(1)) >= 1_000) {
      return `${(value / 1_000_000).toFixed(1)}M`
    }
    return `${thousands.toFixed(1)}K`
  }
  return String(value)
}

export function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) {
    return `$${value.toFixed(4)}`
  }
  return `$${value.toFixed(2)}`
}

export function bytesToMegabytes(bytes: number): number {
  return bytes / 1024 / 1024
}

export function formatBytesAsMegabytes(bytes: number, decimals = 2): string {
  return `${bytesToMegabytes(bytes).toFixed(decimals)} MB`
}

export function formatCompactBytes(bytes: number): string {
  const formatted = prettyBytes(bytes, {
    binary: true,
    maximumFractionDigits: 1,
  })
  return formatted
    .replace('KiB', 'KB')
    .replace('MiB', 'MB')
    .replace('GiB', 'GB')
}

export function formatMegabytes(value: number, decimals = 0): string {
  const options = value >= 1024 && decimals === 0
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  const formatted = prettyBytes(value * 1024 * 1024, {
    binary: true,
    ...options,
  })
  return formatted.replace('MiB', 'MB').replace('GiB', 'GB')
}

export function formatGigabytes(value: number, decimals = 1): string {
  const formatted = prettyBytes(value * 1024 * 1024 * 1024, {
    binary: true,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return formatted.replace('GiB', 'GB')
}

export function formatCpuPercent(percent: number | null): string {
  if (percent === null) {
    return '—'
  }
  if (percent > 0 && percent < 0.1) {
    return '<0.1%'
  }
  return `${percent.toFixed(percent < 10 ? 1 : 0)}%`
}

export function formatResourceUsage(memoryMB: number, cpuPercent: number | null): string {
  return `${formatMegabytes(memoryMB)} / ${formatCpuPercent(cpuPercent)}`
}

export function formatUptimeSeconds(seconds: number, options?: { includeSeconds?: boolean }): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (!options?.includeSeconds) {
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }
  const remainderSeconds = totalSeconds % 60
  return `${hours}h ${minutes}m ${remainderSeconds}s`
}

export function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${remainingSeconds}s`
}

export function formatShortDurationMs(valueMs: number): string {
  const safeValueMs = Math.max(0, Math.round(valueMs))
  if (safeValueMs < 1_000) {
    return `${safeValueMs} ms`
  }
  if (safeValueMs < 60_000) {
    return `${(safeValueMs / 1_000).toFixed(1)} s`
  }
  return formatDuration(safeValueMs, { leading: true })
}

export function formatElapsedRangeMs(
  startedAt: number | null | undefined,
  endedAt: number | null | undefined,
  fallback = 'none',
): string {
  if (!startedAt || !endedAt) {
    return fallback
  }
  return formatShortDurationMs(endedAt - startedAt)
}
