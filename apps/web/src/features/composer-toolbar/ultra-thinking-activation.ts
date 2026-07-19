/**
 * Ephemeral signal recording when the user last explicitly selected the "ultra"
 * thinking effort. Set inside `setThinkingEffort` (the single funnel for all
 * user-driven effort changes); restored or resolved initial state never updates
 * it, so UI decorations can tell a deliberate activation apart from page-load
 * state without threading a flag through the React tree.
 */
let lastUltraThinkingActivatedAt = Number.NEGATIVE_INFINITY

export function markUltraThinkingActivated(): void {
  lastUltraThinkingActivatedAt = performance.now()
}

export function readUltraThinkingActivatedAt(): number {
  return lastUltraThinkingActivatedAt
}
