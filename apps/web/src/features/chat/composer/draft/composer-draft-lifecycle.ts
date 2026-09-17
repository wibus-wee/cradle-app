// Per-surface composer draft lifecycle owner.
//
// One record per surface coordinates the local draft cache, the debounce timer,
// the serialized server write queue, tombstone ordering, the discarded flag,
// and submission settlement. Callers never compose store + transport calls
// themselves: the Composer goes through `useComposerDraftSync`, and Navigation
// only calls `discardComposerDraftSurface` when a surface closes.
import {
  deleteServerComposerDraft,
  writeServerComposerDraft,
} from './composer-draft-server'
import type { ComposerDraft } from './composer-draft-store'
import {
  EMPTY_COMPOSER_DRAFT,
  hasComposerDraftContent,
  hasPersistedComposerDraftContent,
  toPersistedComposerDraft,
  useComposerDraftStore,
} from './composer-draft-store'

const DEBOUNCE_MS = 300

/** Opaque handle for one in-flight submission's settlement. */
export interface ComposerDraftSubmitToken {
  readonly version: number
}

interface DraftSurfaceLifecycle {
  /**
   * Set when the surface was closed. Blocks every write path until an explicit
   * `activateComposerDraftSurface` reopens the surface.
   */
  discarded: boolean
  /** Bumped by every visible draft change that is allowed to persist. */
  editVersion: number
  /** Latest declared visible draft, including submit-suppressed clears. */
  latestDraft: ComposerDraft
  debounceTimer: ReturnType<typeof setTimeout> | null
  /** Non-empty draft scheduled by the debounce but not yet persisted. */
  pendingDraft: ComposerDraft | null
  /**
   * Fingerprint of the last enqueued persisted intent. `null` means the
   * persisted state is a known tombstone/empty; `undefined` means unknown.
   */
  persistedFingerprint: string | null | undefined
  /** Per-surface serialized server operations (writes and tombstones). */
  serverQueue: Promise<void>
  /** Pending submission waiting on an explicit settlement. */
  submit: ComposerDraftSubmitToken | null
}

const lifecycles = new Map<string, DraftSurfaceLifecycle>()

function getLifecycle(surfaceId: string, create: true): DraftSurfaceLifecycle
function getLifecycle(surfaceId: string, create?: false): DraftSurfaceLifecycle | null
function getLifecycle(surfaceId: string, create = false): DraftSurfaceLifecycle | null {
  let lifecycle = lifecycles.get(surfaceId)
  if (!lifecycle && create) {
    lifecycle = {
      // New records start discarded: only an explicit activate opens writes.
      discarded: true,
      editVersion: 0,
      latestDraft: EMPTY_COMPOSER_DRAFT,
      debounceTimer: null,
      pendingDraft: null,
      persistedFingerprint: undefined,
      serverQueue: Promise.resolve(),
      submit: null,
    }
    lifecycles.set(surfaceId, lifecycle)
  }
  return lifecycle ?? null
}

function cancelPendingWrite(lifecycle: DraftSurfaceLifecycle): void {
  if (lifecycle.debounceTimer) {
    clearTimeout(lifecycle.debounceTimer)
    lifecycle.debounceTimer = null
  }
  lifecycle.pendingDraft = null
}

function enqueueServerOperation(
  lifecycle: DraftSurfaceLifecycle,
  operation: () => Promise<void>,
): void {
  const next = lifecycle.serverQueue
    .catch(() => undefined)
    .then(operation)
    .catch(() => undefined)
  lifecycle.serverQueue = next
}

function enqueueDraftWrite(lifecycle: DraftSurfaceLifecycle, surfaceId: string, draft: ComposerDraft): void {
  if (lifecycle.discarded) {
    return
  }
  const persisted = toPersistedComposerDraft(draft)
  const fingerprint = JSON.stringify(persisted)
  if (lifecycle.persistedFingerprint === fingerprint) {
    return
  }
  lifecycle.persistedFingerprint = fingerprint
  enqueueServerOperation(lifecycle, async () => {
    if (lifecycle.discarded) {
      return
    }
    await writeServerComposerDraft(surfaceId, persisted)
  })
}

function enqueueDraftDelete(lifecycle: DraftSurfaceLifecycle, surfaceId: string): void {
  if (lifecycle.persistedFingerprint === null) {
    return
  }
  lifecycle.persistedFingerprint = null
  // Tombstones always enqueue — even after discard — so a discarded surface's
  // pending write can never outlive its tombstone.
  enqueueServerOperation(lifecycle, async () => {
    await deleteServerComposerDraft(surfaceId)
  })
}

/** Mirrors the visible draft into the local cache and enqueues the persisted payload. */
function persistDraftNow(
  lifecycle: DraftSurfaceLifecycle,
  surfaceId: string,
  draft: ComposerDraft,
): void {
  const store = useComposerDraftStore.getState()
  if (hasComposerDraftContent(draft)) {
    store.setDraft(surfaceId, draft)
  }
  else {
    store.deleteDraft(surfaceId)
  }

  if (hasPersistedComposerDraftContent(toPersistedComposerDraft(draft))) {
    enqueueDraftWrite(lifecycle, surfaceId, draft)
  }
  else {
    enqueueDraftDelete(lifecycle, surfaceId)
  }
}

/**
 * Explicitly (re)activates a surface's draft lifecycle. Called by the sync hook
 * on mount; it is the only way a discarded surface accepts writes again.
 */
export function activateComposerDraftSurface(
  surfaceId: string,
  restoredDraft: ComposerDraft | null,
): void {
  const lifecycle = getLifecycle(surfaceId, true)
  lifecycle.discarded = false
  lifecycle.latestDraft = restoredDraft ?? EMPTY_COMPOSER_DRAFT
}

/**
 * The single surface-close operation consumed by Navigation. Fixed order:
 * mark discarded → cancel debounce / block future writes → delete the local
 * draft → enqueue the server tombstone. Repeated calls are idempotent.
 */
export function discardComposerDraftSurface(surfaceId: string): void {
  const lifecycle = getLifecycle(surfaceId, true)
  lifecycle.discarded = true
  lifecycle.submit = null
  cancelPendingWrite(lifecycle)
  lifecycle.latestDraft = EMPTY_COMPOSER_DRAFT
  useComposerDraftStore.getState().deleteDraft(surfaceId)
  enqueueDraftDelete(lifecycle, surfaceId)
}

/**
 * Records that the hook applied an authoritative draft to the visible composer
 * (local restore or server reconcile). Not a user edit: it realigns the
 * lifecycle's view of the draft and, for server-sourced values, the persisted
 * fingerprint so an identical echo does not rewrite the row.
 */
export function noteComposerDraftRestore(
  surfaceId: string,
  draft: ComposerDraft,
  options: { persistedOnServer: boolean },
): void {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle || lifecycle.discarded) {
    return
  }
  lifecycle.latestDraft = draft
  if (options.persistedOnServer) {
    lifecycle.persistedFingerprint = hasPersistedComposerDraftContent(
      toPersistedComposerDraft(draft),
    )
      ? JSON.stringify(toPersistedComposerDraft(draft))
      : null
  }
}

/**
 * The debounced change path driven by the composer's draft-parts publications.
 * While a submission is pending, empty publications are attributed to the
 * optimistic submit clear and never reach persistence — settlement decides.
 */
export function changeComposerDraft(surfaceId: string, draft: ComposerDraft): void {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle || lifecycle.discarded) {
    return
  }

  if (lifecycle.submit && !hasComposerDraftContent(draft)) {
    // Empty publications while a submission is pending are attributed to the
    // optimistic submit clear (or an explicit user clear): they must not reach
    // persistence, and any write scheduled mid-pending is now stale.
    lifecycle.latestDraft = draft
    cancelPendingWrite(lifecycle)
    return
  }

  lifecycle.latestDraft = draft
  lifecycle.editVersion += 1
  cancelPendingWrite(lifecycle)

  if (!hasComposerDraftContent(draft)) {
    persistDraftNow(lifecycle, surfaceId, draft)
    return
  }

  lifecycle.pendingDraft = draft
  lifecycle.debounceTimer = setTimeout(() => {
    lifecycle.debounceTimer = null
    lifecycle.pendingDraft = null
    if (lifecycle.discarded) {
      return
    }
    persistDraftNow(lifecycle, surfaceId, draft)
  }, DEBOUNCE_MS)
}

/** Immediate clear for explicit draft-clear signals (not a submit path). */
export function clearComposerDraft(surfaceId: string): void {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle || lifecycle.discarded) {
    return
  }
  lifecycle.editVersion += 1
  lifecycle.latestDraft = EMPTY_COMPOSER_DRAFT
  cancelPendingWrite(lifecycle)
  useComposerDraftStore.getState().deleteDraft(surfaceId)
  enqueueDraftDelete(lifecycle, surfaceId)
}

/**
 * Unmount flush: persists a pending debounced draft immediately. After discard
 * (or with nothing pending) it writes nothing, so a closed surface's draft can
 * never be resurrected by a late unmount.
 */
export function flushComposerDraft(surfaceId: string): void {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle) {
    return
  }
  const pending = lifecycle.pendingDraft
  cancelPendingWrite(lifecycle)
  if (lifecycle.discarded || pending === null) {
    return
  }
  persistDraftNow(lifecycle, surfaceId, pending)
}

/**
 * Marks the start of a submission whose optimistic UI clear must not delete the
 * persisted draft. Call before dispatching the submit; settle the returned
 * token via `settleComposerDraftSubmit` when the send handler resolves.
 */
export function beginComposerDraftSubmit(surfaceId: string): ComposerDraftSubmitToken | null {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle || lifecycle.discarded) {
    return null
  }
  // The persisted end state is decided at settlement; a pre-submit debounce
  // would only add a redundant write before the accepted tombstone.
  cancelPendingWrite(lifecycle)
  const token: ComposerDraftSubmitToken = { version: lifecycle.editVersion }
  lifecycle.submit = token
  return token
}

/**
 * Settles a submission started with `beginComposerDraftSubmit`.
 *
 * - Accepted: commits exactly one tombstone, unless the user produced a newer
 *   non-empty draft while the submission was pending — a stale settlement never
 *   clears that draft; its own debounce/queue already governs persistence.
 * - Rejected (`accepted: false`): persisted state keeps the pre-submit draft,
 *   unless the user explicitly cleared the composer while pending — then the
 *   persisted state converges to empty as well.
 *
 * Tokens that are null, unknown, or superseded by a later submission are no-ops.
 */
export function settleComposerDraftSubmit(
  surfaceId: string,
  token: ComposerDraftSubmitToken | null,
  accepted: boolean,
): void {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle || token === null || lifecycle.submit !== token) {
    return
  }
  lifecycle.submit = null
  if (lifecycle.discarded) {
    return
  }
  const draftChangedWhilePending = lifecycle.editVersion !== token.version
  const latestHasContent = hasComposerDraftContent(lifecycle.latestDraft)
  if (accepted) {
    if (draftChangedWhilePending && latestHasContent) {
      return
    }
    persistDraftNow(lifecycle, surfaceId, EMPTY_COMPOSER_DRAFT)
    return
  }
  if (draftChangedWhilePending && !latestHasContent) {
    persistDraftNow(lifecycle, surfaceId, EMPTY_COMPOSER_DRAFT)
  }
}

/**
 * Uploads a draft through the serialized queue (used by reconciliation when the
 * server has no draft row but local state exists). Discard-aware like any write.
 */
export function queueComposerDraftServerWrite(surfaceId: string, draft: ComposerDraft): void {
  const lifecycle = getLifecycle(surfaceId, false)
  if (!lifecycle || lifecycle.discarded) {
    return
  }
  enqueueDraftWrite(lifecycle, surfaceId, draft)
}

/** Test/observability seam: resolves when the surface's server queue drains. */
export function flushComposerDraftServerQueue(surfaceId: string): Promise<void> {
  return lifecycles.get(surfaceId)?.serverQueue ?? Promise.resolve()
}
