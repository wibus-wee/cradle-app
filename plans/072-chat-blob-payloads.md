# Plan 072: Move chat message bytes into a content-addressed blob store, losslessly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat facc38f5..HEAD -- apps/server/src/modules/chat-runtime apps/server/src/modules/assets apps/web/src/features/chat/rendering apps/web/src/features/chat/tool-blocks packages/db/src/schema`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition. **Expect drift** in
> `apps/web/src/features/chat/rendering/tool-ui-classifier.ts`,
> `apps/server/src/modules/chat-runtime/ui-message.ts`,
> `apps/server/src/modules/chat-runtime/interaction/steer-turn.ts` and
> `apps/server/src/modules/chat-runtime/run/turn-draft.ts`, which had uncommitted
> work in progress at planning time. Re-locate excerpts by symbol name, not by
> line number.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: MED
- **Depends on**: none
- **Category**: perf + bug
- **Planned at**: commit `facc38f5`, 2026-07-29
- **Supersedes**: the earlier three-plan split (072 blob store / 073 attachment
  bytes / 074 tool payloads) and its unwritten Plan 075 backfill. Those files were
  replaced by this one; see "Why this is one plan" below.

## Why this matters

**The size problem.** `chat_message_payloads.message_json` stores the full
`UIMessage` JSON for every message. When a user pastes a screenshot, or a provider
returns an image block, the bytes land in that JSON as a
`data:image/png;base64,...` URL. Observed sessions reach ~117 MB across ~52
messages. That cost is paid four times on every session open — the SQLite TEXT
copy, the server-side `JSON.parse` object graph, the HTTP response string, and the
renderer's own parse — plus a fifth copy in the renderer's IndexedDB cache. Base64
also inflates the bytes 33% before any of that happens. Because the same
screenshot steered into three turns is stored three times, the growth compounds.

**The correctness problem.** When a tool's input or output serializes to more than
128 000 characters, the server **destroys** it at persist time and replaces it with
a marker object (`cradle.truncated-json-payload.v1`). Nothing in `apps/web` knows
that marker exists: a repository-wide search finds only the server file that writes
it. `readToolPayload` maps the marker's fields onto nothing, so a large tool result
renders as an empty block with no indication that anything was truncated, and the
discarded content exists nowhere on disk.

**The payoff sequencing.** Externalizing bytes at the persist boundary only stops
*new* growth. The existing ~117 MB session does not shrink by a single byte until a
backfill pass rewrites the rows that still hold their bytes. Backfill is therefore
not an optional epilogue — it is the step that makes the pain go away, and it is
cheap only if it reuses the same seam. That is why it is Step 9 of this plan rather
than a separate follow-up.

### Why this is one plan

The work was originally split into three plans plus an unwritten fourth. Two
things forced consolidation:

1. The split had a hard contradiction. The draft-attachment step required the
   blob-store plan's garbage collector to skip a `draft:` prefix that plan never
   specified, and `composer_drafts.surface_id` is not a session id (the literal
   `'new-chat'` is a valid surface), so a draft ref could not satisfy the
   `session_id NOT NULL REFERENCES sessions(id)` column the same split defined.
   Composer-draft externalization is dropped here; see "Out of scope".
2. The externalization seam, the tool-payload seam, and the backfill worker are
   the same walk over the same message. Writing them as three plans meant three
   implementations of one traversal and three sets of write-ordering rules.

## Current state

Every excerpt below was verified against commit `facc38f5`.

### The lossy tool-payload truncation

```11:38:apps/server/src/modules/chat-runtime/message-snapshot-compaction.ts
export function truncateJsonPayload(value: unknown, maxChars: number): unknown {
  if (value === undefined || value === null) {
    return value
  }

  try {
    const json = JSON.stringify(value)
    if (json.length <= maxChars) {
      return value
    }
    return {
      type: 'cradle.truncated-json-payload.v1',
      originalChars: json.length,
      preview: json.slice(0, maxChars),
    }
  }
 catch {
    const text = String(value)
    if (text.length <= maxChars) {
      return text
    }
    return {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: text.length,
      preview: text.slice(0, maxChars),
    }
  }
}
```

The limits:

```6:9:apps/server/src/modules/chat-runtime/message-snapshot-compaction.ts
const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000
const DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS = 512 * 1024
```

Where it is applied to tool parts:

```141:158:apps/server/src/modules/chat-runtime/message-snapshot-compaction.ts
    if ('toolCallId' in part && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
      let nextPart = part as Record<string, unknown>
      if ('input' in nextPart) {
        const inputPayload = truncateJsonPayload(nextPart.input, toolPayloadLimit)
        if (inputPayload !== nextPart.input) {
          changed = true
          nextPart = { ...nextPart, input: inputPayload }
        }
      }
      if ('output' in nextPart) {
        const outputPayload = truncateJsonPayload(nextPart.output, toolPayloadLimit)
        if (outputPayload !== nextPart.output) {
          changed = true
          nextPart = { ...nextPart, output: outputPayload }
        }
      }
      return nextPart as UIMessage['parts'][number]
    }
```

`compactStoredMessageSnapshot` has five call sites; confirm with
`rg -n "compactStoredMessageSnapshot\(" apps/server/src`:

| Call site | Nature | This plan |
|---|---|---|
| `run/terminal-finalizer.ts:147` | durable assistant persist | externalize |
| `run/turn-executor.ts:243`, `:662` | observability snapshots | leave lossy |
| `stream/active-run-stream.ts:76` | crash-recoverable checkpoint | externalize losslessly |
| `es/projectors.ts:230` | sync re-projection of an already-stored message | no change |

`compactStoredMessageSnapshotForRead` (lines 50-73) has **zero** call sites
anywhere in the repo. It is dead code. (An earlier draft of this plan claimed its
final statement returns `input.message`; it actually returns `compactedMessage`.
It is still dead, but delete it because it is unused, not because it is wrong.)

### Why the renderer shows nothing for a truncated payload

`ToolPayload` is a flat record of named fields, and every reader pulls a specific
key off the payload object:

```880:903:apps/web/src/features/chat/rendering/tool-ui-classifier.ts
export function readToolPayload(value: unknown): ToolPayload {
  const builtinResult = readBuiltinToolCallResultPayload(value)
  if (builtinResult) {
    return readToolPayload(builtinResult.result)
  }
  const builtinInput = readBuiltinToolCallInputPayload(value)
  if (builtinInput) {
    return readToolPayload(builtinInput.args)
  }
  if (typeof value === 'string') {
    return {
      ...toolPayloadFromObject(readToolObjectPayload({})),
      rawText: value,
      rawValue: value,
    }
  }
  if (Array.isArray(value)) {
    return {
      ...toolPayloadFromObject(readToolObjectPayload({ contents: value })),
      rawValue: value,
    }
  }
  return toolPayloadFromObject(readToolObjectPayload(value))
}
```

A truncation marker takes the last branch. `type` maps to
`'cradle.truncated-json-payload.v1'` and every other field resolves to `null`, so
the block renders empty. Note the `typeof value === 'string'` branch: it puts the
text in `rawText`, and `rawText` is already a rendered fallback both in the
classifier's own summary logic and in
`apps/web/src/features/chat/tool-blocks/views/tool-call-details.tsx`. **Mapping the
marker's `preview` into `rawText` is therefore the whole fix** — no new component
is required to make truncated payloads visible.

### Every durable message-JSON write

`rg -n "messageJson: JSON.stringify" apps/server/src/modules/chat-runtime`
(ignoring `*.test.ts`) returns exactly five production sites, in three files:

```137:162:apps/server/src/modules/chat-runtime/run/turn-draft.ts
export async function insertCompletedUserMessage(
  input: InsertCompletedUserMessageInput,
): Promise<void> {
  const now = currentUnixSeconds()
  await commitSessionEvents(input.sessionId, [
    {
      type: 'SteerApplied',
      payload: {
        message: {
          id: input.message.id,
          sessionId: input.sessionId,
          parentMessageId: input.parentMessageId ?? null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(input.message),
          messageJson: JSON.stringify(input.message),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  ])
}
```

```212:227:apps/server/src/modules/chat-runtime/run/turn-draft.ts
function createUserMessageFact(sessionId: string, message: UIMessage, now: number) {
  return {
    id: message.id,
    sessionId,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: 'user' as const,
    status: 'complete' as const,
    content: extractMessageText(message),
    messageJson: JSON.stringify(message),
    createdAt: now,
    updatedAt: now,
  }
}
```

`createUserMessageFact` serves both the plain `UserMessageAppended` append and the
user message committed alongside `RunStarted`. `startRun` also serializes the
initial assistant message at `turn-draft.ts:200`.

```139:153:apps/server/src/modules/chat-runtime/run/terminal-finalizer.ts
  async function persistTerminalMessageSnapshot(
    activeRun: ActiveRun,
    status: TerminalChatMessageStatus,
    errorText: string | null,
    bindingId?: string | null,
  ): Promise<{ messageJsonBytes: number }> {
    const now = currentUnixSeconds()
    const message = annotateRunResultMessage(
      compactStoredMessageSnapshot(normalizeMessageSnapshot(activeRun.finalMessage)),
      {
        runId: activeRun.runId,
        durationMs: Math.max(0, (now - activeRun.startedAtSeconds) * 1000),
      },
    )
    const messageJson = JSON.stringify(message)
```

This function is already `async` and already returns
`{ messageJsonBytes: Buffer.byteLength(messageJson) }`, surfaced as
`profile.finalMessageJsonBytes` — the byte accounting you need for verification
already exists.

`bang-command.ts:176` and `:195` serialize a bang user message and its result
message with the same inline fact literal shape.

Two paths deliberately need **no** seam:

- `interaction/steer-turn.ts` builds the steer message and calls
  `insertCompletedUserMessage`, so it is covered by `turn-draft.ts`.
- `es/recovery.ts:796-804` (`normalizeTerminalMessageJson`) re-serializes JSON it
  just read from the database, so its URLs are already references.

### The provider input path that must be able to read bytes back

```66:71:apps/server/src/modules/chat-runtime/ui-message.ts
/**
 * Replaces image file parts explicitly prepared by the local Light OCR flow
 * with text before a provider sees the message. The original message remains
 * unchanged for the transcript and attachment UI.
 */
export function projectLightOcrMessage(message: UIMessage): UIMessage {
```

Its production call sites (`rg -n "projectLightOcrMessage" apps/server/src`) are
`run/run-coordinator.ts:361`, `:373`, `:375`, `interaction/steer-turn.ts:145`, and
`side-chat/response.ts:119`, `:125`. Light OCR inspects image parts, so blob
resolution must run **before** it at every one of them.

### Patterns to imitate

Path sandboxing (`apps/server/src/modules/assets/service.ts`):

```70:88:apps/server/src/modules/assets/service.ts
function resolveDataRoot(): string {
  const config = getServerConfig()
  return resolve(config.dataDir ?? dirname(config.dbPath))
}

function resolveStoragePath(storagePath: string): string {
  const dataRoot = resolveDataRoot()
  const fullPath = resolve(dataRoot, storagePath)
  const rel = relative(dataRoot, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError({
      code: 'asset_storage_path_invalid',
      status: 500,
      message: 'Asset storage path is outside the Cradle data directory',
      details: { storagePath },
    })
  }
  return fullPath
}
```

Byte-serving route (`apps/server/src/modules/assets/index.ts`):

```42:58:apps/server/src/modules/assets/index.ts
  .get('/:id/content', async ({ params }) => {
    const asset = await Assets.readAssetBytes(params.id)
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        'content-type': asset.mediaType,
        'content-length': String(asset.byteSize),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }, {
    detail: {
      summary: 'Read asset content',
      description: 'Return the stored asset bytes. The first implementation is image-only and does not implement Range requests.',
    },
    params: AssetsModel.idParams,
  })
```

Background work registration (`apps/server/src/modules/chat-runtime/run-snapshot-maintenance.ts`):

```1:16:apps/server/src/modules/chat-runtime/run-snapshot-maintenance.ts
import * as Maintenance from '../maintenance/service'
import { maintainRunSnapshots } from './run-snapshot'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

export function registerRunSnapshotMaintenance(): void {
  Maintenance.registerTask({
    ownerNamespace: 'chat-runtime',
    key: 'maintain-run-snapshots',
    title: 'Maintain run snapshots',
    intervalMs: DEFAULT_INTERVAL_MS,
    runOnStart: true,
    manuallyRunnable: true,
    run: () => ({ ...maintainRunSnapshots() }),
  })
}
```

`Maintenance.registerTask` is the only correct way to add background work here: it
registers the task with Background Activity, which owns scheduling, jitter,
deadlines, manual runs and progress reporting.

```7:26:apps/server/src/modules/maintenance/service.ts
export interface MaintenanceRunContext {
  now: number
  deadline: number
  source: BackgroundActivity.BackgroundActivityRunSource
  report: (progress: BackgroundActivityProgress | null) => void
}

export type MaintenanceResult = BackgroundActivityProgress

export interface MaintenanceTaskDescriptor {
  ownerNamespace: string
  key: string
  title: string
  priority?: BackgroundActivityPriority
  intervalMs: number | null
  runOnStart: boolean
  manuallyRunnable: boolean
  maxRunMs?: number
  run: (context: MaintenanceRunContext) => Promise<MaintenanceResult> | MaintenanceResult
}
```

`MaintenanceResult` is `BackgroundActivityProgress`, an open
`Record<string, BackgroundActivityProgressValue>` — return counters directly, do
not invent a result type. `context.deadline` and `context.report` are how a long
backfill stays interruptible and visible; use both in Step 9. Default `maxRunMs`
is 30 000, so a long-running task must set its own.

Registrations live at `apps/server/src/app.ts:379-382`, next to
`GitHubCache.registerGithubCacheMaintenance()`,
`ComposerDrafts.registerComposerDraftMaintenance()`,
`registerRunSnapshotMaintenance()` and
`TurnCheckpoint.registerTurnCheckpointMaintenance()`. The `assets` module is
mounted at `app.ts:239`.

Frontend URL-scheme resolution already exists for assets — read
`apps/web/src/features/assets/asset-url.ts` before writing the blob equivalent and
match its shape (`isCradleAssetUrl` / `readAssetIdFromUrl` / `toAssetContentUrl`,
where `toAssetContentUrl` resolves against `getServerUrl()`).

Shared server/web contracts live in `packages/chat-runtime-contracts`;
`src/message-split-boundary.ts` is the precedent for a pure, I/O-free contract
helper, re-exported from `src/index.ts` (line 3).

`readPositiveIntegerEnv(name, fallback)` from `apps/server/src/helpers/env.ts` is
how every existing limit in this area is read.

### Relevant schema

```5:20:packages/db/src/schema/assets.ts
export const assets = sqliteTable('assets', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mediaType: text('media_type').notNull(),
  byteSize: int('byte_size').notNull(),
  width: int('width'),
  height: int('height'),
  sha256: text('sha256').notNull(),
  storagePath: text('storage_path').notNull(),
  ...createdAt(),
}, table => ({
  byWorkspace: index('assets_workspace_id_idx').on(table.workspaceId),
  bySha256: index('assets_sha256_idx').on(table.sha256),
}))
```

`sha256` is recorded but used for neither deduplication nor the on-disk path.

```71:82:packages/db/src/schema/chat.ts
export const chatMessagePayloads = sqliteTable('chat_message_payloads', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  messageJson: text('message_json').notNull(),
  errorText: text('error_text'),
  ...timestamps(),
}, table => ({
  bySession: index('chat_message_payloads_session_id_idx').on(table.sessionId),
}))
```

### Repo conventions you must follow

From `AGENTS.md` (repo root):

> - **Prefer breaking refactors over compatibility shims.**
> - **Trust TypeScript types.** Annotate values with their expected types
>   directly. Avoid `unknown` + inline type guards.
> - **Don't invent new types or projections.** Exhaust existing library APIs and
>   patterns before introducing new abstractions.
> - **Separate concerns.** Don't lock everything in one file.
> - **Discuss before using heuristics.**
> - **Always use Drizzle** … Use drizzle-kit for schema management and migrations.

From `apps/server/AGENTS.md`: a module is `index.ts` (routes) / `model.ts`
(TypeBox) / `service.ts` (logic) / `README.md` (ownership); business errors are
`AppError` with a stable `code`; infrastructure must not depend on business
modules.

From `AGENTS.md` §3 (Frontend Rendering Seams): `*View` modules take typed props
and must not read queries, stores or routes; §1: all Tailwind classes static,
combined with `cn()` from `@/lib/utils`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Generate migration | `pnpm --filter @cradle/db generate` | exit 0; one new `packages/db/drizzle/00NN_*.sql` |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Module boundaries | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Focused blob-store tests | `pnpm --filter @cradle/server exec vitest run src/modules/blob-store --maxWorkers=1 --reporter=dot` | all pass |
| Focused chat-runtime tests | `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime --maxWorkers=1 --reporter=dot` | all pass |
| Web tests | `pnpm --filter @cradle/web test` | all pass |
| Full server tests | `pnpm --filter @cradle/server test` | see note |
| Lint touched files | `pnpm exec eslint <paths>` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

**Note on the full server suite**: known-red at baseline (sandboxed local-listen,
Git GPG, parallel Chronicle/preferences suites — see the Plan 055 note in
`plans/README.md`). Record pass/fail counts and confirm no *new* failure names
`blob-store`, `chat-runtime` or `assets`. Do not fix unrelated failures.

## Scope

**In scope**:

- `apps/web/src/features/chat/rendering/tool-ui-classifier.ts` (+ its test)
- `packages/db/src/schema/blob-store.ts` (create), `packages/db/src/schema/chat.ts`
  (one new table), `packages/db/src/schema/index.ts` (re-export),
  `packages/db/drizzle/*` (generated migration only)
- `apps/server/src/modules/blob-store/{service,model,index,gc,README}.ts|md`
  (create) and `{service,gc}.test.ts`
- `packages/chat-runtime-contracts/src/blob-reference.ts` (create) and
  `src/index.ts` (re-export)
- `apps/server/src/modules/chat-runtime/message-blob-externalization.ts` (create)
  and its test
- `apps/server/src/modules/chat-runtime/message-durable-payload.ts` (create)
- `apps/server/src/modules/chat-runtime/message-snapshot-compaction.ts`
- `apps/server/src/modules/chat-runtime/run/{terminal-finalizer,turn-draft}.ts`,
  `bang-command.ts`
- `apps/server/src/modules/chat-runtime/ui-message.ts` and the provider input call
  sites listed above
- `apps/server/src/modules/chat-runtime/message-blob-backfill.ts` (create) and its
  test
- `apps/web/src/features/assets/blob-url.ts` (create) and the components that
  currently resolve `cradle-asset://`
- `apps/web/src/features/chat/tool-blocks/views/tool-call-details.tsx`
- `apps/server/src/app.ts` (mount + two task registrations)
- `apps/server/src/modules/chat-runtime/README.md`,
  `apps/server/src/modules/assets/README.md` (one sentence about GC ownership)

**Out of scope** (do NOT touch, even though they look related):

- **Rerouting `assets` writes through blob-store**, and adding `assets.blob_id`.
  Tempting, but it contributes nothing to this plan's goal while adding an
  `ALTER TABLE assets` (which Drizzle may emit as a table rebuild), a behavior
  change to `deleteAsset`, and churn in the asset tests. Record the resulting
  duplication — two byte stores coexist — in `blob-store/README.md` as a known,
  deliberate deferral. Do not silently leave it undocumented.
- **Composer draft attachments** (`composer-drafts.ts`,
  `composer_drafts.draft_json`). Drafts do not accumulate: one row per surface,
  reset on send or discard. Externalizing them requires polymorphic ownership in
  the ref table (`surface_id` is not a session id — `'new-chat'` is a valid
  surface) and a soft-delete-aware liveness check, for a bounded sink. If it later
  matters, it needs `owner_kind` + `owner_id` columns and its own plan.
- **The producers of inline data URLs.** They keep emitting `data:` URLs:
  `apps/web/src/features/chat/composer/composer-attachment-state.ts`,
  `apps/web/src/features/browser/browser-panel.tsx`,
  `chat-runtime-providers/claude-agent/event-to-chunk-mapper.ts`,
  `chat-runtime-providers/codex/provider.ts`,
  `chat-runtime-providers/codex/turn/event-to-chunk-mapper.ts`,
  `chat-runtime-providers/codex/local-image-data-url.ts`. Five producers is five
  diffs and still misses the sixth; one persistence seam catches all of them.
- **`stream/active-run-stream.ts` and `run_stream_checkpoints`.** Deleted at
  terminal, but recoverable into a durable `AssistantMessageCompleted` fact after
  a crash. The checkpoint therefore uses the full durable externalization seam for
  files, tool payloads, text, and reasoning; content addressing deduplicates
  unchanged streamed payloads.
- **`run/turn-executor.ts` observability snapshots.** Same reasoning.

  **Landed state (differs from the sketch above).** Once Step 9b made prose
  lossless, `compactStoredMessageSnapshot` had no work left and became an identity
  function still threaded through five call sites — a seam that implied compaction
  was happening when it was not. It was replaced by the explicitly transient
  `compactTransientMessageSnapshot`. Recoverable checkpoints were subsequently
  moved to `toDurableMessagePayload` so crash recovery cannot make a lossy snapshot
  permanent. Observability keeps its cap explicitly: `projectAiObservationMessage` and the
  `outputChoices` capture call `truncateSnapshotPayload` on the parts, so a
  diagnostic record cannot grow with a 20 MB transcript merely because the durable
  path stopped truncating. `truncateSnapshotPayload` is now documented as
  transient-only and must never be reachable from a durable write.
- **`DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS` / `..._REASONING_MAX_CHARS`.** Prose
  truncation is a different problem; 256 000 characters of prose is already
  pathological. Leave both untouched.
- **`history-api.ts`.** It returns the full parsed `message_json` per row on
  purpose, so clients never need per-row detail fetches. That stays true: the
  snapshot no longer *contains* megabytes because oversized values are references.
  Do not add a truncating read projection and do not add pagination.
- **`apps/web/src/features/chat/session/stable-message-cache.ts`.** Its IndexedDB
  copy shrinks automatically once payloads carry references. No schema bump.
- **A `schema_version` column on `chat_message_payloads`.** Parts are
  self-describing; a legacy row is simply a row with no reference parts, and
  hydration code is identical for both. A row version would force a dual read path
  for no benefit.

## Git workflow

- Branch: `advisor/072-chat-blob-payloads`
- One commit per step, conventional-commit style (see `git log --oneline -5`, e.g.
  `feat(chat-runtime): integrate provider usage telemetry`). Scope `chat` for web
  commits, `chat-runtime` for chat server commits, `blob-store` for the new module,
  `db` for schema.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Make already-truncated tool payloads visible (web only, no dependencies)

This is a standalone user-visible bug fix. It must land first and must not wait for
any server work.

In `apps/web/src/features/chat/rendering/tool-ui-classifier.ts`, add a branch to
`readToolPayload` that recognizes the two legacy markers
(`cradle.truncated-json-payload.v1`, `cradle.truncated-text-payload.v1`) before the
generic object branch, and maps them onto the payload the renderer already knows how
to display:

- `rawText` ← the marker's `preview`
- `rawValue` ← the marker object
- two new `ToolPayload` fields: `truncatedOriginalChars: number | null` and
  `blobId: string | null` (the latter stays `null` here and is filled in Step 8)

Add the two fields to the `ToolPayload` interface and to `toolPayloadFromObject`'s
return so the type stays exhaustive.

Then in `apps/web/src/features/chat/tool-blocks/views/tool-call-details.tsx`, when
`truncatedOriginalChars` is set, render a single line stating how large the original
was and that the remainder is unavailable. Static Tailwind classes only, combined
with `cn()`. No fetching — there is nothing to fetch for a legacy marker.

Do not attempt to `JSON.parse` a `preview`; it is a prefix of a JSON string and is
usually invalid JSON. It goes in `rawText` as text, exactly like the existing
`typeof value === 'string'` branch does.

**Verify**:
- `pnpm --filter @cradle/web typecheck` → exit 0
- `pnpm --filter @cradle/web exec vitest run src/features/chat/rendering/tool-ui-classifier.test.ts` → all pass, including new tests 12-13 from the test plan
- `pnpm --filter @cradle/web test` → all pass

### Step 1: Add the `blobs` and `chat_message_blob_refs` tables

Create `packages/db/src/schema/blob-store.ts` using the same helpers
`assets.ts` imports (`textPk()`, `text()`, `int()`, `index()`, `uniqueIndex()`,
`createdAt()`):

- `id` — `textPk()`
- `sha256` — `text('sha256').notNull()` with a **unique** index; this is what makes
  the store content-addressed and gives deduplication for free
- `mediaType` — `text('media_type').notNull()`
- `byteSize` — `int('byte_size').notNull()`
- `storagePath` — `text('storage_path').notNull()`, data-directory-relative
- `createdAt()`

Add to `packages/db/src/schema/chat.ts` a table `chat_message_blob_refs`:

- `id` — `textPk()`
- `sessionId` — `text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' })`
- `messageId` — `text('message_id').notNull()`, **deliberately no foreign key**
- `partPath` — `text('part_path').notNull()`, a JSON-pointer-ish locator with one
  single meaning, e.g. `/parts/7/output`. Do not overload it with tool call ids or
  hashes.
- `kind` — `text('kind', { enum: ['tool_output', 'tool_input', 'file'] }).notNull()`
- `blobId` — `text('blob_id').notNull().references(() => blobs.id, { onDelete: 'restrict' })`
- `createdAt()`
- Indexes on `sessionId`, `messageId`, `blobId`, plus a unique index on
  `(messageId, partPath)`

Two decisions here are load-bearing and must not be "tidied up" later. Record both
as comments in the schema file.

**`blobId` uses `onDelete: 'restrict'`.** Deleting a session cascades the *refs*
away; the collector in Step 3 is the only thing that ever deletes a blob. A cascade
from ref to blob would unlink bytes another ref still points at, because the store
deduplicates by content hash.

**`messageId` has no foreign key, on purpose.** The write order must be
blob → ref → message commit. That order makes every crash window safe: an
interrupted write leaves an extra ref (harmless, swept later) and never a
`cradle-blob://` URL whose blob has no ref. A foreign key to `messages.id` would
force the opposite order, and a crash in that window would leave a persisted
message referencing a blob with zero refs — which the collector would then delete.
That is silent data loss.

Re-export from `packages/db/src/schema/index.ts`, matching the alphabetical
`export * from './...'` style.

**Verify**:
- `pnpm --filter @cradle/db generate` → exit 0, prints one new migration filename
- Open the generated `.sql`: it must contain `CREATE TABLE` for both new tables and
  **no** `DROP` statement and no rewrite of an existing table

### Step 2: Create the `blob-store` module with a policy-free byte API

Create `apps/server/src/modules/blob-store/service.ts`. Copy the sandbox pattern
from the `assets` excerpt above into a local `resolveBlobStorePath(storagePath)`,
using `blob_*` error codes (`blob_storage_path_invalid`). Do not import from
`assets` and do not modify it.

Storage layout is content-addressed and must be exactly:

```
blobs/<first two hex chars of sha256>/<full sha256>
```

The two-character shard prevents one directory with hundreds of thousands of
entries. There is no owner segment — ownership lives in the ref tables, not the
filesystem.

Public API, every signature annotated with real types (no `unknown`):

- `putBlob(input: { bytes: Buffer, mediaType: string }): Promise<BlobRecord>` —
  hash the bytes; if a row with that `sha256` exists, return it without writing
  (the dedup path); otherwise `mkdir` the shard, write the file, then insert the
  row. Wrap the insert in the same try/catch-and-`rm` shape `createAsset` uses so a
  failed insert leaves no orphan file. Because the path is content-addressed, a
  concurrent writer may already have created the file — use `writeFile` **without**
  the `wx` flag and rely on the hash for correctness. Explain that in a one-line
  comment; it is the one place where the reasoning is not obvious from the code.
- `getBlob(id: string): BlobRecord` — throws `AppError` with code `blob_not_found`,
  status 404, mirroring `asset_not_found`.
- `readBlobBytes(id: string): Promise<{ bytes: Buffer, mediaType: string, byteSize: number }>`

Create `model.ts` with TypeBox schemas for the metadata response and an `idParams`,
mirroring `apps/server/src/modules/assets/model.ts`.

Create `index.ts` exporting
`new Elysia({ prefix: '/blobs', detail: { tags: ['blob-store'] } })` with
`GET /:id` (metadata) and `GET /:id/content` (bytes). Copy the response headers from
the `assets` content route verbatim, including `x-content-type-options: nosniff` —
except make `cache-control` `private, max-age=31536000, immutable`, which for
content-addressed bytes is now exactly correct rather than optimistic. There is
**no** upload route: bytes enter only through server-side owners calling `putBlob`.
Do not add `x-cradle-cli` metadata; this is not a CLI surface.

Create `README.md`: blob-store owns content-addressed bytes under the server data
directory, hash deduplication, the metadata index, byte serving, and garbage
collection. It owns **no** policy — no image re-encoding, no size limits beyond what
callers impose, no media-type validation. Owners keep their own policy and their own
reference tables. State the deliberate deferral: `assets` still writes its own
files under `assets/…` and is not yet a blob-store consumer.

Mount it in `apps/server/src/app.ts` next to `app.use(assets)`.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/server check:boundaries` → exit 0
- `rg -n "blobStore|blob-store" apps/server/src/app.ts` → shows the mount

### Step 3: Register the garbage collector as a Background Activity maintenance task

Create `apps/server/src/modules/blob-store/gc.ts` exporting
`registerBlobStoreMaintenance()`, modeled on `run-snapshot-maintenance.ts`:
`ownerNamespace: 'blob-store'`, `key: 'collect-unreferenced-blobs'`,
`intervalMs` one hour, `runOnStart: true`, `manuallyRunnable: true`.

Two phases per pass:

**Phase A — drop orphan refs.** Delete rows from `chat_message_blob_refs` whose
`messageId` matches no row in `messages` and whose `createdAt` is older than the
grace period. These arise legitimately: `messageId` has no foreign key (Step 1), so
a crash between the ref insert and the message commit, or a turn rollback that
removes a message, leaves refs behind. Without Phase A those refs pin their blobs
forever.

**Phase B — collect unreferenced blobs.** Select blobs that no
`chat_message_blob_refs` row references and whose `createdAt` is older than the
grace period. Bound the batch to at most 500 blobs per pass.

For each one, **delete the row first, then `rm` the file** with `force: true`. The
order is a correctness requirement, not a style choice. `putBlob` deduplicates by
hash, so a concurrent writer can be handed this exact row and insert a ref for it;
the row delete then fails under the `onDelete: 'restrict'` foreign key. Catch that
failure, count it as `blobsSkipped`, and leave the blob for a later pass. Unlinking
the file first would instead strip the bytes out from under a ref and a stored
message — a blob row and `message_json` that both look healthy while the bytes are
gone, which is the exact failure this plan exists to remove. Crashing between the
two steps only leaks a file with no row, which is harmless: the path is
content-addressed and `putBlob` rewrites it without an exclusive flag.

The grace period (`CRADLE_BLOB_GC_GRACE_SECONDS`, default and minimum 3600) is
load-bearing in both phases, not a magic number. Chat claims blob + ref in one
SQLite transaction, but non-transactional producers may still commit that ref
before the message. Configuration may extend the window but is clamped at one hour
so an operator cannot invalidate the write-order safety contract.

Return counters as the `MaintenanceResult` (`refsDropped`, `blobsCollected`,
`blobsSkipped`, `bytesFreed`) so Background Activity shows progress. Register it in `app.ts`
alongside the existing registrations at lines 379-382.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/server exec vitest run src/modules/blob-store --maxWorkers=1 --reporter=dot` → all pass, including tests 7-14

### Step 4: Define the reference contracts

Create `packages/chat-runtime-contracts/src/blob-reference.ts` — pure contract, no
I/O, like `message-split-boundary.ts`. It holds both reference forms because they
are the same concern (a chat message pointing at stored bytes):

```ts
export const CRADLE_BLOB_URL_SCHEME = 'cradle-blob:'

export function formatBlobUrl(blobId: string): string
export function parseBlobUrl(url: string): string | null
export function isInlineDataUrl(url: string): boolean

export interface ChatBlobPayloadRef {
  type: 'cradle.blob-payload-ref.v1'
  blobId: string
  mediaType: string
  originalChars: number
  preview: string
}

export function isChatBlobPayloadRef(value: unknown): value is ChatBlobPayloadRef
export function readLegacyTruncatedPayload(
  value: unknown,
): { preview: string, originalChars: number } | null
```

`ChatBlobPayloadRef` is a strict superset of the old truncation marker: same
`originalChars`, same `preview`, plus `blobId` and `mediaType`. That is deliberate —
the only new capability is that the rest can now be fetched.

`readLegacyTruncatedPayload` matches both legacy marker types and is what Step 0's
web branch should switch to once this package is available, so the marker shape is
described in exactly one place. Re-export everything from
`packages/chat-runtime-contracts/src/index.ts`.

**Verify**: `pnpm --filter @cradle/server typecheck` and
`pnpm --filter @cradle/web typecheck` → both exit 0

### Step 5: Write one externalization seam for both attachment bytes and tool payloads

Create `apps/server/src/modules/chat-runtime/message-blob-externalization.ts`:

```ts
export async function externalizeMessageBlobs(input: {
  sessionId: string
  message: UIMessage
}): Promise<UIMessage>
```

One walk over `message.parts` handling two cases.

**File parts.** For `part.type === 'file'` whose `url` is an inline `data:` URL
(`isInlineDataUrl`), decode the base64 payload to a `Buffer`, read the media type
from the data URL header falling back to the part's `mediaType`, `putBlob`, insert a
ref with `partPath` `/parts/<index>/url` and `kind: 'file'`, and replace the `url`
with `formatBlobUrl(blobId)`, preserving `mediaType` and `filename`. Leave
`cradle-blob://`, `cradle-asset://`, `file://` and `http(s)://` untouched. Skip data
URLs whose decoded byte length is below
`CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES` (default 4096) — a 200-byte inline icon
does not justify a file and a DB row. This is a threshold with an explicit env
override, not a heuristic.

**Tool parts.** For parts where `'toolCallId' in part` and
(`part.type === 'dynamic-tool'` or `part.type.startsWith('tool-')`), check `input`
and `output`. When `JSON.stringify(value).length` exceeds
`CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS` (existing env var, default 128 000):
`putBlob({ bytes: Buffer.from(json, 'utf8'), mediaType: 'application/json' })`,
insert a ref with `partPath` `/parts/<index>/output` or `/parts/<index>/input` and
`kind` `'tool_output'` or `'tool_input'`, and replace the value with a
`ChatBlobPayloadRef` whose `preview` is `json.slice(0, previewChars)`.

Use a **separate, much smaller** preview limit:
`CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS`, default 4096. This is where most of the
size win comes from — with the full payload safely in a blob, keeping 128 000
characters inline is pure waste.

Rules that apply to both cases:

- All ref inserts use `onConflictDoNothing` on the `(messageId, partPath)` unique
  index, so re-persisting the same message (the `onConflictDoUpdate` path in
  `putMessagePayload`) and re-running the backfill are both idempotent.
- **Write order is blob → ref → (caller commits message).** Never commit the
  message first. Add a comment stating this and pointing at Step 1's no-foreign-key
  rationale.
- **The blob claim and its ref insert must share one write transaction.** Give
  `putBlob` an explicit db/transaction handle parameter and pass the same handle to
  the ref insert, so the dedupe `SELECT` and the ref `INSERT` are atomic against the
  GC.

  This is load-bearing, not tidiness. `putBlob` deduplicates by content hash, so it
  can return a row that is old *and* currently unreferenced — that is, already
  eligible for collection — because the caller has not written its ref yet. Across
  two transactions, a GC pass landing in that window deletes the row and the ref
  insert then fails on the `blobId` foreign key, failing a user's message persist.
  Inside one transaction, SQLite serializes the two writers: either the GC deletes
  first and the dedupe `SELECT` finds nothing (a fresh row and file are written), or
  the ref lands first and the GC's row delete fails and is skipped. Step 3's GC
  already orders row-delete before file-unlink so that the losing side never leaves
  a referenced blob without bytes; this rule closes the other half.
- Return the **same object reference** when nothing changed, matching the
  `changed`-flag convention in `compactStoredMessageSnapshot`. Callers rely on cheap
  identity checks.
- Values already in reference form are left alone, so the function is safe to run
  twice on the same message.

Then create `apps/server/src/modules/chat-runtime/message-durable-payload.ts` with
the single place in the codebase that turns a `UIMessage` into durable JSON:

```ts
export function toDurableMessagePayload(input: {
  sessionId: string
  message: UIMessage
  d?: BlobStoreWriteHandle
}): { message: UIMessage, content: string, messageJson: string }
```

It calls `externalizeMessageBlobs`, then `extractMessageText` and `JSON.stringify`.
It returns the primitives rather than a fact object so each call site keeps its own
fact shape — do not invent a unified fact type.

Route every durable site through it:

- `run/turn-draft.ts` — `createUserMessageFact` becomes async and spreads
  `{ content, messageJson }`; `insertCompletedUserMessage` (the `SteerApplied`
  path) and the `startRun` assistant message both use it too.
- `run/terminal-finalizer.ts` — inside `persistTerminalMessageSnapshot`, after
  `annotateRunResultMessage(compactStoredMessageSnapshot(...))` and instead of the
  bare `JSON.stringify`. The function is already `async`. Keep returning
  `messageJsonBytes` from the returned `messageJson`.
- `bang-command.ts` — both sites.
- `es/projectors.ts` — plan implementation approval mutation, using the active
  projection transaction.
- `external-session-import/service.ts` — using the import transaction.
- `thread-handoff/service.ts` — resolve source refs, assign the destination
  message id, then externalize under the destination session.

The point of this indirection is that the invariant stops being reviewer-enforced.
After this step there is exactly one `JSON.stringify` of a `UIMessage` on the
durable path, so a future persist site cannot forget the seam by accident.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `rg -n "messageJson: JSON.stringify" apps/server/src/modules/chat-runtime --glob '!*.test.ts'` → no matches
- `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime --maxWorkers=1 --reporter=dot` → all pass

### Step 6: Retire the lossy tool truncation from the durable path only

In `message-snapshot-compaction.ts`:

- Delete `compactStoredMessageSnapshotForRead` entirely. Confirm zero callers first
  with `rg -n "compactStoredMessageSnapshotForRead" .`; a caller is a STOP
  condition. Removing it prevents a future reader from wiring up a lossy read-path
  repair.
- Remove the tool `input`/`output` truncation block from
  `compactStoredMessageSnapshot` (the excerpt in "Current state"). Tool payloads now
  belong to the async seam. Keep the `text` and `reasoning` truncation exactly as
  is.
- Keep `truncateJsonPayload` and `truncateSnapshotPayload` exported for disposable
  observability records in `run/turn-executor.ts`; recoverable stream checkpoints
  must not use them.

Note the one consequence to accept and document: `es/projectors.ts:230` re-projects
an already-stored message through `compactStoredMessageSnapshot` synchronously
inside a transaction. After this change it no longer re-truncates tool payloads —
which is correct, because it is writing back the same bytes it just read. It needs
no async seam and must not get one.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `rg -n "compactStoredMessageSnapshotForRead" .` → no matches
- `rg -n "cradle.truncated-json-payload" apps/server/src` → matches only inside
  `truncateJsonPayload`
- `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime --maxWorkers=1 --reporter=dot` → all pass

### Step 7: Resolve blob references before any provider sees the message

In `apps/server/src/modules/chat-runtime/ui-message.ts`, add an async projection
next to `projectLightOcrMessage` that converts `cradle-blob://` file parts back to
inline data URLs for provider consumption, documented in the same voice ("The
original message remains unchanged for the transcript and attachment UI").

Wire it into every `projectLightOcrMessage` call site, ordered so blob resolution
runs **before** Light OCR projection — Light OCR inspects image parts and must see
real bytes. The sites are `run/run-coordinator.ts:361`, `:373`, `:375`,
`interaction/steer-turn.ts:145`, `side-chat/response.ts:119`, `:125`.

This is the step that can silently break the product: if a provider path is missed,
images stop reaching the model with no error and no failing test. Enumerate every
call site in your report and state, for each, that blob resolution now precedes it.

**Correction — this step originally claimed tool payload refs need not be resolved
here, on the theory that providers get their own tool results from their own runtime
and the reference form only ever lives in Cradle's stored transcript. That is false,
and the STOP condition it carried duly fired during implementation.**

Cradle does replay stored tool outputs back to a model: Codex's
`injectCradleTranscriptHistory` feeds `part.output` from the stored transcript, and
the OpenAI-compatible history path does the same. A tool payload ref left in place on
those paths would hand the model a `ChatBlobPayloadRef` object to interpret as if it
were the tool's output. So this step resolves **both** forms — `cradle-blob:` file
URLs and `ChatBlobPayloadRef` values — and the tests pin that neither form can reach
a provider.

For the same reason, enumerating `projectLightOcrMessage` call sites is not
sufficient to find every provider input path. Codex prefers
`input.transcript?.history ?? input.history`, so `transcript.history` needs projecting
too. Grep for the history-bearing provider request fields, not just the OCR sites.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime src/modules/chat-runtime-providers --maxWorkers=1 --reporter=dot` → all pass

### Step 8: Resolve references in the renderer

Create `apps/web/src/features/assets/blob-url.ts` mirroring `asset-url.ts` (read it
first): `isCradleBlobUrl`, `readBlobIdFromUrl`, and `toBlobContentUrl(id)` resolving
`/blobs/<id>/content` against `getServerUrl()`. Extend every component that
currently resolves `cradle-asset://` to also resolve `cradle-blob://`; find them with
`rg -rn "cradle-asset" apps/web/src`. Attachment thumbnails and inline images then
render from the HTTP content route instead of an inline data URL, and because the
bytes are content-addressed and served `immutable`, the browser caches them after
the first fetch.

Then extend Step 0's classifier branch: when a payload is a `ChatBlobPayloadRef`
(`isChatBlobPayloadRef`), populate `rawText` from `preview`, `truncatedOriginalChars`
from `originalChars`, and `blobId` from `blobId`. In `tool-call-details.tsx`, when
`blobId` is set, render the size line as a link to `toBlobContentUrl(blobId)`
labeled as opening the full output, instead of the "unavailable" note.

Deliberately keep this a plain link rather than an in-place expander: no fetch, no
loading state, no new Container, and no `*View` violating §3 by owning a query. If
product later wants inline expansion, that is a separate change with a Container
that owns the fetch.

Check `buildToolDescriptorCacheSignature` — the descriptor cache is keyed on tool
identity, state and input/output identity. Reference payloads are stable objects, so
the existing key is sufficient; confirm this rather than assuming, and extend the key
if you find otherwise.

**Verify**:
- `pnpm --filter @cradle/web typecheck` → exit 0
- `rg -rn "cradle-blob" apps/web/src` → shows the resolver and at least one consumer
- `pnpm --filter @cradle/web test` → all pass, including tests 15-17

### Step 9: Backfill existing rows as a Background Activity task

This is the step that shrinks the database you already have. Everything before it
only stops new growth.

Create `apps/server/src/modules/chat-runtime/message-blob-backfill.ts` exporting
`registerMessageBlobBackfillMaintenance()` plus the pure worker it calls, so the
worker is testable without the scheduler.

Per pass:

1. Select a bounded batch of `chat_message_payloads` rows, largest
   `length(message_json)` first, whose `message_json` still contains either
   `;base64,` or `cradle.truncated-json-payload`, **and** whose
   `length(message_json)` exceeds `CRADLE_CHAT_BLOB_BACKFILL_MIN_ROW_CHARS`
   (default 64 000). Ordering by size means the first pass reclaims the most
   bytes. Batch size from `CRADLE_CHAT_BLOB_BACKFILL_BATCH` (default 50).

   The size floor is not cosmetic. Without it, a row whose only inline data URLs
   sit below `CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES` matches the text predicate
   forever while the seam correctly declines to rewrite it, so every hourly pass
   would rescan the same rows. The floor excludes them because such a row is
   small by construction. A pathological row that is large only because it holds
   many sub-floor icons can still be rescanned each pass; accept that — it costs
   one `JSON.parse` per pass, it is visible in the reported counters as "scanned,
   0 rewritten", and it is strictly preferable to adding a per-row `checked`
   column to `chat_message_payloads` for a transient migration.
2. Inner-join `messages` on `messages.payloadId = chatMessagePayloads.id` and take
   `messages.id` as the `messageId` for ref inserts. `chat_message_payloads` has no
   `messageId` column, and `externalizeMessageBlobs` needs one because
   `chat_message_blob_refs.messageId` is `NOT NULL`.

   Use the join rather than assuming `payloadId === messages.id`. That identity holds
   today at every writer, but it is an implicit coupling the backfill should not
   depend on, and the join buys a second property for free: it skips payload rows
   that no message points at. Those exist — `LastTurnRolledBack` deletes `messages`
   rows without deleting their payload rows. Externalizing such a row would write
   refs under a `messageId` that does not exist, which the GC's Phase A then drops an
   hour later, reclaiming the blobs again. Nothing reads those rows, so skip them
   instead of doing work that undoes itself.
3. For each row: `JSON.parse` it, run `externalizeMessageBlobs` with the row's
   `sessionId`, the joined `messageId`, and the parsed message, and if the returned
   object is not identical, write back through the existing payload-store update
   path. Skip rows that fail to parse and count them; never write a row you could not
   parse.
4. Stop early when `context.deadline` passes, and call `context.report` between
   batches so Background Activity shows progress.
5. Return counters: rows scanned, rows rewritten, blobs written, bytes reclaimed,
   rows skipped.

Register it with `intervalMs` of one hour, `runOnStart: true`,
`manuallyRunnable: true`, and an explicit `maxRunMs` well above the 30 000 default
(the default would abort a large batch mid-pass).

### Step 9a: What the first implementation got wrong, measured against a real database

The first cut of Step 9 was built from this plan's text and reclaimed far less than the
plan promised. These numbers come from a real 16 773-row `chat_message_payloads`
(868.1 MB of `message_json` accumulated in about five weeks, still growing 20-60 MB a
day):

| Category | Rows | Bytes | Reclaimed by the first cut |
| --- | --- | --- | --- |
| Legacy truncation markers | 413 | 365.7 MB | no — the seam short-circuits them |
| Inline `;base64,` attachments | 202 | 269.7 MB | yes |
| Large tool payloads, neither marker nor base64 | 1 108 | 296.5 MB | no — predicate misses them |
| Overlap of the first two | 51 | 94.3 MB | partly |

Three corrections follow, and they are the difference between reclaiming roughly a
third of the addressable bytes and reclaiming nearly all of them.

**1. Shrink legacy truncation markers in place. Do not try to salvage them into
blobs.** A legacy marker holds a 128 000-character *prefix* of a payload whose
remainder was already destroyed — the bytes exist nowhere, so nothing can restore
completeness. Salvaging the surviving prefix into a blob would preserve every
character, but it would also force `ChatBlobPayloadRef` to distinguish "this blob is
the whole output" from "this blob is a salvaged prefix", and the renderer would have
to stop saying "open full output" for the second case. That contract and UI complexity
buys the tail of a fragment that is known to be incomplete. So instead: rewrite the
marker's `preview` down to `CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS`, keep `type`
and `originalChars` unchanged so the renderer still reports the true original size and
still says the remainder is unavailable, and produce no blob.

This shrink belongs in the backfill, not in `externalizeMessageBlobs`. The live seam
correctly refuses to touch legacy markers; reshaping historical damage is a migration
concern with a different owner.

**2. Widen the predicate to rows carrying tool parts.** The `;base64,` /
`cradle.truncated-json-payload` patterns were chosen to target what the seam can act
on, but they miss the largest category: 1 108 large rows match neither, and 1 101 of
them (99.7%, 295.7 MB) carry tool parts that Step 5 externalizes by size for new
messages. Add a `message_json LIKE '%"type":"tool-%'` arm alongside the existing two,
still gated by the `length(message_json)` floor.

**3. Replace the repeating scan with a terminating sweep.** With the widened
predicate, "rescan whatever still matches" no longer converges: a message with many
tool calls keeps one ~4 KB preview per payload, so after a successful rewrite it can
still sit above the size floor with nothing left to externalize, and every later pass
parses it again. Multiplied across 1 666 large rows that is hundreds of megabytes of
`JSON.parse` per hour, forever, for zero yield.

Sweep by `id` ascending instead, and persist the cursor. Record the maximum payload id
at sweep start; when the cursor passes it the sweep is finished, because every row
created after that point was written through the Step 5 seam and needs no backfill. A
one-shot sweep that provably terminates is strictly better than a steady-state scan.

Persist the cursor and the completion flag in the existing
`database_maintenance_tasks` table (`id`, `status: pending | completed`, `detailJson`)
under an id like `chat-blob-backfill-v1`, and no-op once that row is `completed`. That
table already exists for exactly this shape of one-shot migration — the historical
`compact-chat-storage-v1` entry there is, fittingly, the task that created the legacy
truncation markers in the first place. Do not add a column or a table for the cursor,
and do not run the sweep from the boot-time migration runner: an 868 MB sweep must not
block startup, which is why this stays a Background Activity task.

Idempotence comes for free from three places: already-externalized values are left
alone by the seam, ref inserts use `onConflictDoNothing`, and `putBlob` deduplicates
by hash. Rows whose tool payload was already destroyed by the old truncation cannot
be recovered — the bytes exist nowhere. Those rows are matched only so their oversized
128 000-character previews get shrunk in place per Step 9a correction 1, keeping
`type` and `originalChars`; they yield no blob and they are **not** converted to a
reference. Say so in the module README.

**Residual coverage, measured.** After the three predicate arms, exactly 7 rows /
0.8 MB of the 868.1 MB remain unmatched, and **zero** of them are `dynamic-tool`
parts. A fourth arm for `"type":"dynamic-tool"` was considered and rejected on that
evidence: it would add a predicate branch for no measurable bytes. Do not add it
without re-measuring first.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/message-blob-backfill --maxWorkers=1 --reporter=dot` → all pass, including tests 18-22

### Step 9b: Stop destroying text and reasoning content

Step 6 moved tool payloads onto the blob seam and deliberately left text and reasoning
truncation alone. That leaves the same class of silent data loss live on the primary
content users actually read, and it is happening now: 109 stored rows already carry
`providerMetadata.cradle.truncated`, 101 of them from the last month, the most recent
one day before this step was written — roughly three or four messages a day losing
prose permanently.

Read `compactStoredMessageSnapshot` before changing it. Two properties of the current
code matter:

- The limits are a **shared budget per message** (`remainingText` starts at 256 000,
  `remainingReasoning` at 64 000) that each part decrements in order. A part reached
  after the budget is exhausted is sliced to a **zero-length string** — not shortened,
  erased — while being marked `truncated: true`.
- The cut text is written nowhere. `originalChars` records what the length used to be,
  which is exactly enough information to know that something was lost and not enough
  to get it back.

Extend the Step 5 seam to cover `text` and `reasoning` parts: the full text becomes a
blob, the part keeps a bounded inline prefix, and the part carries a reference to the
remainder. Reuse `ChatBlobPayloadRef` and the existing ref table; `chat_message_blob_refs.kind`
is a Drizzle text column whose `enum` is a TypeScript-level constraint only, so adding
a kind for text does **not** need a migration — confirm that by running
`pnpm --filter @cradle/db generate` and checking that it produces no new SQL.

Two invariants constrain the design, and they pull against each other:

1. **No text may be destroyed.** Every character that used to be dropped must be
   recoverable from a blob. In particular, no part may end up as an empty string
   without a reference that can restore it.
2. **Inline size must not materially regress.** Switching the shared budget to a
   per-part limit would let a ten-part message keep ten times as much text inline as
   it does today. Keeping today's message-level budget and sending only the overflow to
   a blob preserves current sizes while removing the loss.

Prefer the second reading: keep the existing budget semantics, externalize the
overflow. If you find a cleaner arrangement that satisfies both invariants, take it and
say why in your report.

On the web side, a text part with an externalized remainder must show that the rest
exists and is fetchable, in the same spirit as the tool-payload notice from Step 8.
Do not silently render the prefix as if it were the whole message — that is the bug
this step exists to remove, merely relocated.

### Step 10: Document the invariants and run the final gates

Add to `apps/server/src/modules/chat-runtime/README.md`, near the existing statement
that `message_json` is the hydration source of truth: `message_json` remains the
single hydration truth and its parts are self-describing. Inline attachment bytes
never appear in it — a file part carries a `cradle-blob://` URL. An oversized tool
payload appears as a `cradle.blob-payload-ref.v1` value carrying a preview and a
blob id. There is **no** row-level schema version and **no** dual read path: a
legacy row is simply a row with no reference parts. Every durable persist goes
through `toDurableMessagePayload`; truncation is permitted only on disposable
observability snapshots, not crash-recoverable stream checkpoints.

Add one sentence to `apps/server/src/modules/assets/README.md` noting that
unreferenced-byte garbage collection now exists in `blob-store` and that `assets`
is not yet a blob-store consumer.

**Verify**, in order:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/server check:boundaries` → exit 0
- `pnpm --filter @cradle/web typecheck` → exit 0
- `pnpm --filter @cradle/web test` → all pass
- `pnpm --filter @cradle/server test` → record counts; no new failure naming `blob-store`, `chat-runtime` or `assets`
- `pnpm exec eslint apps/server/src/modules/blob-store apps/server/src/modules/chat-runtime packages/chat-runtime-contracts apps/web/src/features/chat apps/web/src/features/assets packages/db/src/schema` → exit 0
- `git diff --check` → no output
- `git status` → no modified file outside the In-scope list

## Test plan

Model DB-touching server tests on `apps/server/src/modules/chat-runtime/es/parity.test.ts`
for setup style.

`apps/server/src/modules/blob-store/service.test.ts`:

1. `putBlob` writes the file at `blobs/<sha[0:2]>/<sha>` and inserts one row.
2. `putBlob` twice with identical bytes returns the same id and leaves exactly one
   row and one file (the deduplication contract).
3. `putBlob` with different bytes and the same media type creates two rows.
4. `getBlob` on a missing id throws `AppError` with code `blob_not_found`, status 404.
5. `readBlobBytes` round-trips the exact bytes written.
6. `resolveBlobStorePath` rejects a `storagePath` containing `../` with code
   `blob_storage_path_invalid`. This path-traversal regression test must exist.

`apps/server/src/modules/blob-store/gc.test.ts`:

7. A blob with no refs, older than the grace period, is collected: row gone, file gone.
8. A blob with no refs created *within* the grace period is **not** collected — the
   Phase B race regression test.
9. A blob referenced by a `chat_message_blob_refs` row is not collected.
10. A blob referenced by two refs survives deletion of one of them.
11. Deleting the session cascades refs away and a later sweep collects the blob.
12. A ref whose `messageId` matches no `messages` row, older than the grace period,
    is deleted by Phase A and its blob becomes collectable.
13. The same ref *within* the grace period is **not** deleted — the Phase A race
    regression test protecting the blob→ref→message write order.
14. A pass with more than 500 collectable blobs collects at most 500 and reports it.

`apps/server/src/modules/chat-runtime/message-blob-externalization.test.ts`:

15. A message with one `data:image/png;base64,...` part above the floor yields a
    `cradle-blob://` url, one `blobs` row, one ref with `partPath === '/parts/0/url'`
    and `kind === 'file'`.
16. **Attachment round trip**: externalize, then run the Step 7 provider projection;
    the resulting data URL is byte-identical to the input. This proves no image
    content is lost.
17. `JSON.stringify(result).length` is at least 10× smaller than the input for a
    1 MB inline image. Assert the ratio, not an absolute number.
18. A data URL below `CRADLE_CHAT_INLINE_ATTACHMENT_MAX_BYTES` stays inline and
    creates no rows.
19. Parts with `file://`, `http://`, `cradle-asset://` and `cradle-blob://` urls are
    untouched, and the function returns the identical object reference when nothing
    changed.
20. Two messages carrying identical image bytes produce two refs and exactly one
    `blobs` row — the dedup regression test that fixes repeated steering of one
    screenshot.
21. A tool part with a 900 KB `output` yields a `cradle.blob-payload-ref.v1` with the
    right `originalChars`, a `preview` of exactly
    `CRADLE_CHAT_STORED_TOOL_PREVIEW_MAX_CHARS` characters, one `blobs` row and one
    ref with `kind === 'tool_output'`, `partPath === '/parts/0/output'`.
22. **Tool payload round trip**: fetch the blob bytes and `JSON.parse` them; the
    result deep-equals the original `output`. This is the losslessness proof and the
    single most important test in this plan.
23. `input` and `output` both oversized on one part produce two refs with distinct
    `partPath` values.
24. A small tool payload is untouched and creates no rows.
25. Running externalization twice on the same message and part path inserts one ref,
    not two.
26. The persisted `message_json` for a message with a 900 KB tool output is under
    ~10 KB, and does not contain `cradle.truncated-json-payload`.

Alongside the existing terminal-finalizer tests: persisting an assistant message
with an inline image results in a `chat_message_payloads.message_json` that contains
`cradle-blob://` and does **not** contain `base64`.

`apps/server/src/modules/chat-runtime/message-blob-backfill.test.ts`:

27. A pre-seeded row with a 1 MB inline image is rewritten to reference form; the row
    shrinks by more than 10×; the blob bytes round-trip.
28. Running the backfill twice leaves one blob row and one ref, and the second pass
    reports zero rewrites.
29. A row whose `message_json` is malformed is skipped and counted, not rewritten.
30. Batch bounding is respected: with more matching rows than the batch size, exactly
    the batch size is processed and the counters say so.
31. A row containing a legacy truncation marker is rewritten without producing a
    blob, and the destroyed remainder is not fabricated.

`apps/web/src/features/chat/rendering/tool-ui-classifier.test.ts`:

32. A payload that is a legacy `cradle.truncated-json-payload.v1` exposes its
    `preview` as `rawText` and its `originalChars`, with `blobId === null`. **This is
    the regression test for the live bug** — assert the payload is populated, not
    empty.
33. The same for `cradle.truncated-text-payload.v1`.
34. A payload that is a `cradle.blob-payload-ref.v1` exposes `preview` as `rawText`,
    plus `originalChars` and `blobId`.
35. An ordinary inline payload classifies exactly as it does today — guard against
    regressing the common path.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server check:boundaries` exits 0
- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web test` exits 0
- [ ] `pnpm --filter @cradle/server exec vitest run src/modules/blob-store src/modules/chat-runtime --maxWorkers=1 --reporter=dot` passes, including tests 1-31
- [ ] Tests 32-35 exist and pass in `tool-ui-classifier.test.ts`
- [ ] Both round-trip tests (16 and 22) exist and assert byte identity / deep equality
- [ ] `pnpm --filter @cradle/db generate` produced exactly one new migration, with no `DROP TABLE` and no column drop
- [ ] `rg -n "messageJson: JSON.stringify" apps/server/src/modules/chat-runtime --glob '!*.test.ts'` returns no matches
- [ ] `rg -n "compactStoredMessageSnapshotForRead" .` returns no matches
- [ ] `git diff --stat apps/server/src/modules/chat-runtime/history-api.ts` shows no changes
- [ ] `git diff --stat apps/server/src/modules/assets/service.ts` shows no changes
- [ ] `git diff --stat apps/server/src/modules/chat-runtime/composer-drafts.ts` shows no changes
- [ ] `git status` shows no modified file outside the In-scope list
- [ ] `git diff --check` produces no output
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- `pnpm --filter @cradle/db generate` emits a `DROP TABLE`, a column drop, or a
  rewrite of an existing table. The expand-only shape is mandatory; a destructive
  migration here can lose user data.
- `rg -n "compactStoredMessageSnapshotForRead" .` finds a caller. Something wired up
  the dead read-path compaction between planning and execution; deleting it would
  then change behavior and needs its own review.
- Either round-trip test (16, 22) cannot be made to pass exactly. That means the
  externalize/resolve pair is lossy, which defeats the entire purpose. Report what
  differs rather than loosening the assertion.
- You cannot enumerate every provider input path that needs blob resolution
  (Step 7), or you find a provider path that replays stored tool outputs back to the
  model. A missed path loses images silently, with no test failure and no error.
- Removing tool truncation from `compactStoredMessageSnapshot` breaks
  `stream/active-run-stream.ts` or `run/turn-executor.ts`. Those must keep using
  `truncateSnapshotPayload`.
- You find yourself wanting to add a truncating projection to `history-api.ts`, a
  `schema_version` column on `chat_message_payloads`, or `owner_kind`/`owner_id`
  columns to support composer drafts. All three are explicitly rejected here; report
  the pressure that made one look necessary.
- Externalization is synchronous and accepts the caller's write handle specifically
  so projectors/importers can preserve their existing transaction boundary. Do not
  hide it inside `putMessagePayload`; message construction still owns the policy.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **The invariants this establishes**: (1) `chat_message_payloads.message_json`
  never contains inline attachment bytes; (2) an oversized tool payload is a
  self-describing reference, never a destroyed value; (3) there is exactly one
  `JSON.stringify` of a `UIMessage` on the durable path, and it is
  `toDurableMessagePayload`. Any new durable persist that bypasses it is a defect,
  and any truncation added to the durable path is a regression.
- **What a reviewer should scrutinize**: the write order is blob → ref → message at
  every site; every `projectLightOcrMessage` call site is preceded by blob
  resolution; both round-trip tests assert exact equality; the legacy-truncated
  branch exists in the classifier, because that is the user-visible bug fix and it
  is the easiest thing to skip; the GC grace period exists and has tests in both
  phases; the tool preview limit dropped from 128 000 to ~4096, which is where most
  of the inline size win comes from; `assets`, `composer-drafts` and `history-api`
  are untouched.
- **What cannot be fixed**: tool payloads already destroyed by the old truncation
  are gone. No backfill can recover them. Step 9 only reshapes those rows; Step 5
  protects future ones.
- **Known remaining copy**: a data URL still crosses the HTTP request once when
  the composer submits. Checkpoints retain only lossless blob references.
- **Deliberately deferred**, in rough priority order: routing `assets` writes
  through blob-store and dropping `assets.storage_path` (the second byte store is
  documented debt, not an accident); composer draft attachments; Range requests on
  `/chat/sessions/:sessionId/blobs/:blobId/content`, needed only once large files are stored; per-tool-kind
  externalization policy — a blanket byte threshold can cut a large diff at an
  arbitrary point, but since the full payload is one fetch away this is a
  presentation concern, and its right owner is the tool classifier that already
  decides how each tool renders, not a second threshold in the persist path;
  derived thumbnails, which should be separate derived blobs and must never replace
  an original, because tool screenshots have to stay pixel-exact for their text to
  remain legible.
