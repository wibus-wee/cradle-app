export function relativeTime(timestamp: number | null): string {
  if (!timestamp) {
    return 'No activity'
  }
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp))
  if (seconds < 60) {
    return 'Just now'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  return `${Math.floor(hours / 24)}d ago`
}

export function compactPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.length > 2 ? `.../${segments.slice(-2).join('/')}` : path
}

export function durationLabel(startedAt: number, completedAt: number | null): string {
  const end = completedAt ?? Date.now() / 1000
  const seconds = Math.max(0, Math.floor(end - startedAt))
  if (seconds < 60) {
    return `${seconds}s`
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
