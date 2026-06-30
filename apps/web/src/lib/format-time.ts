function _timeAgo(timestamp: number, now: number): string {
  const seconds = Math.floor((now - timestamp) / 1000)
  if (seconds < 60) {
    return '刚刚'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}小时前`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days}天前`
  }
  return `${Math.floor(days / 30)}个月前`
}

function _timeAgoShort(tsSeconds: number, nowMs: number): string {
  const diff = Math.floor(nowMs / 1000) - tsSeconds
  if (diff < 60) {
    return '刚刚'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 86400)}d`
  }
  return `${Math.floor(diff / 2592000)}mo`
}

const timestampFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short',
})

const timeOnlyFmt = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function _formatTimestamp(tsSeconds: number): string {
  return timestampFmt.format(tsSeconds * 1000)
}

export function formatTimeOnly(tsMs: number): string {
  return timeOnlyFmt.format(tsMs)
}
