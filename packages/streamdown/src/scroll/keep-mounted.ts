/**
 * Determines if a message should use keepMounted in a virtual list.
 * Streaming messages should never be recycled mid-stream.
 *
 * Usage with virtua or react-window:
 *   <VirtualItem keepMounted={shouldKeepMounted(message.streaming)} />
 */
export function shouldKeepMounted(isStreaming: boolean): boolean {
  return isStreaming
}

/**
 * Creates a keepMounted map for a list of messages.
 * Returns indices of messages that should be kept mounted.
 */
export function getKeepMountedIndices(messages: { streaming?: boolean }[]): Set<number> {
  const indices = new Set<number>()
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].streaming) {
      indices.add(i)
    }
  }
  return indices
}
