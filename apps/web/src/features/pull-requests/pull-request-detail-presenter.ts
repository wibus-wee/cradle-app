import type { PullRequestDetail } from './api/pull-requests'

type PullRequestFile = PullRequestDetail['files'][number]

export function formatPullRequestTimestamp(
  timestamp: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export function formatPullRequestRelativeTime(
  iso: string,
  now: number,
): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) {
    return `${Math.max(minutes, 0)}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  return `${Math.floor(hours / 24)}d`
}

export function buildPullRequestFilePatch(file: PullRequestFile): string {
  const oldPath = file.previousFilename ?? file.filename
  const oldMarker = file.status === 'added' ? '/dev/null' : `a/${oldPath}`
  const newMarker = file.status === 'removed' ? '/dev/null' : `b/${file.filename}`
  return [
    `diff --git a/${oldPath} b/${file.filename}`,
    `--- ${oldMarker}`,
    `+++ ${newMarker}`,
    file.patch ?? '',
  ].join('\n')
}

export function isPullRequestCheckFailure(conclusion: string | null): boolean {
  return conclusion !== null && [
    'action_required',
    'cancelled',
    'failure',
    'stale',
    'startup_failure',
    'timed_out',
  ].includes(conclusion)
}
