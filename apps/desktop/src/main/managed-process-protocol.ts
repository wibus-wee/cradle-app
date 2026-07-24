/** Preserve target IPC payloads while the runner adds its ownership envelope. */
export function forwardManagedTargetMessage(message: unknown): {
  type: 'target-message'
  message: unknown
} {
  return { type: 'target-message', message }
}
