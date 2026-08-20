export function formatAttentionWaiting(seconds: number): string {
  if (seconds < 60) {
    return '<1m'
  }
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m`
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3_600)}h`
  }
  return `${Math.floor(seconds / 86_400)}d`
}
