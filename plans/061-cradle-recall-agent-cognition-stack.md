# Plan 061: Cradle Recall — Agent Cognition Stack and CodeAct retrieval

> **Executor instructions**: This plan is **design-first**. Phase A (this document +
> capability spec + skill contract) must land before any runtime implementation.
> Follow milestones in order; honor STOP conditions. When Phase A is merged, update
> the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat HEAD -- plans/061-cradle-recall-agent-cognition-stack.md plans/061-recall-retrieval-contract.md apps/server/specs/capabilities/recall.md`
> Mismatch between this plan and live docs is a STOP condition until reconciled.

## Status

- **Priority**: P1
- **Effort**: XL (split across 4 phases; Phase A is S and shippable alone)
- **Risk**: MED — retrieval touches agent cognition boundaries; implementation risk is
  LOW if Phase A contract is respected
- **Depends on**: 024 (DONE), 041 (DONE); **implementation** should wait on 050, 051
  for trustworthy scope/evidence joins
- **Category**: direction, agent-design
- **Planned at**: 2026-07-21

## Why this matters

Cradle is an **agent management platform**. Agents running inside Cradle need
**explicit execution memory** — the ability to query what they (or sibling sessions)
did before, cite evidence, and optionally persist approved conclusions. This is
distinct from:

- **Harness (L4)** — deterministic, push-only turn context (Work state, system identity)
- **Chronicle (L2)** — ambient capture → curated long-term memory
- **Search module today** — human-facing thread FTS with incomplete wiring
- **Orchestration (L5)** — Work / Issue / Queue routing

[Obelisk](https://github.com/tommy0103/obelisk) demonstrates the correct **agent
design** for this problem: **CodeAct retrieval** (one composable query primitive +
skill contract), **evidence vs synthesis separation**, and **no ambient auto-recall**.
Cradle should adopt the **cognition model**, not clone Obelisk's external JSONL indexer.

Without a upper-layer design, a premature `recall_query` tool will attach to the wrong
layer (harness injection, duplicate Chronicle, or a forest of fine-grained MCP tools).

## Product intent

**Cradle Recall** (working name; not "Obelisk module") gives in-chat agents:

1. **`recall_query`** — read-only CodeAct sandbox over native Cradle evidence + memory
2. **`recall_attune`** (later) — user-approved synthesis writes to durable memory (L2)
3. **Skill + retrieval contract** — how to orient, scope, retrieve, and cite

Human browse may reuse the same query core later; **agent explicit act is the primary
surface**.

## Agent Cognition Stack (authoritative layering)

Cradle agent cognition is modeled as **five layers + execution cross-cut**:

```text
L5  Orchestration     Work, Issue, Queue, Automation, Session Await
                    → who runs what, in which container, under which constraints

L4  Context Assembly  Harness fragments, bounded transcript, skills prefix
                    → what enters the turn by default (push, cache-friendly)

L3  Retrieval         recall_query, recall_attune (in-chat tools)
                    → agent-initiated observe / approved commit

L2  Memory            Chronicle memories, knowledge cards, attune records
                    → curated synthesis, not raw transcript

L1  Evidence          session_events → messages/payloads, run_snapshot_events,
                    provider-thread fetches, chronicle activity segments,
                    external-session-import facts
                    → append-only ground truth projections

──  Execution (cross) Chat Runtime, providers, filesystem/shell tools
                    → agent acts in the environment now
```

### Layer rules (agent design)

| Layer | Enters context by default? | Agent act? | Authority |
| ----- | ------------------------- | ---------- | --------- |
| L1 Evidence | **No** | via L3 only | **Highest** for "what happened" |
| L2 Memory | **No** | via L3 read; L3 attune write (approved) | Prior note; verify against L1 |
| L3 Retrieval | **Only as tool result** | **Yes** — explicit | Bounded JSON observe |
| L4 Assembly | **Yes** — stable prefix + tail | No | Deterministic domain state |
| L5 Orchestration | **Structured task state** | Indirect (queue, work) | Task routing, not history |

**Red lines:**

- Do **not** register Recall as a harness context source (no ambient recall).
- Do **not** expose `search()`, `failures()`, `fileHistory()` as separate MCP tools —
  they are **sandbox helpers** inside `recall_query` (CodeAct, not tool sprawl).
- Do **not** rebuild the system prompt each turn with retrieval results (Append-System-Prompt).

## Runtime contract (two-tier, Obelisk-aligned)

### Tier 1 — Tool primitives (hard boundary)

| Verb | In-chat tool | Semantics |
| ---- | ------------ | --------- |
| **query** | `recall_query(code)` | Read-only JS in sandbox; returns JSON |
| **attune** | `recall_attune(code)` | Mutation sandbox: `remember()` / `forget()` only |

Optional later: CLI `cradle recall query` / `cradle recall attune` mirroring Tier 1.

**Not in Tier 1:** `build` (indexer) — Cradle indexes from native ES projectors, not
external JSONL. Index maintenance is server lifecycle, not agent-facing.

### Tier 2 — Sandbox helpers (locked to skill + contract tests)

Helpers available inside `recall_query` only (initial set):

| Helper | Purpose |
| ------ | ------- |
| `overview(opts?)` | Orient: workspace/work context, recent sessions — map, not evidence |
| `search(text, opts?)` | FTS / structured search over L1 messages |
| `context(messageId)` | Expand one hit: neighbors, run, session meta |
| `thread(sessionId, opts?)` | Bounded transcript |
| `failures(opts?)` | Tool failures from run snapshot evidence |
| `fileHistory(path, opts?)` | File-touch tool calls |
| `runs(sessionId, opts?)` | Run list + terminal status |
| `memories(opts?)` | L2 recall (Chronicle + attune) |
| `sql(query, ...params)` | Read-only SELECT/WITH escalation |

Return shapes are **contract-tested**; changing a helper requires doc + test update
(see Obelisk ADR-0002 pattern).

## Authority model

When sources conflict:

1. **L1 Evidence** wins for factual claims ("what was edited", "which tool failed")
2. **L2 Memory** is a prior note — never treated as proof without L1 support
3. **Agent synthesis** must cite stable IDs from L3 results for every factual claim

### Synthesis protocol (skill-enforced)

When a query returns **both** evidence and memory, the agent must follow this
**three-channel** shape in the `recall_query` script return value when doing synthesis:

```js
return {
  evidence: [/* search/failures/fileHistory hits with ids + snippets */],
  memories: [/* memories() hits with id + summary */],
  conflicts: [/* explicit pairs where memory contradicts evidence, or [] */],
};
```

**Answer rules** (final message to user):

| Claim type | Rule |
| ---------- | ---- |
| **Fact** (who/when/what file/tool) | Must trace to `evidence[]` with cited IDs. No ID → do not state as fact. |
| **Interpretation** (why, intent, lesson) | Label as inference; may use memory as hypothesis if evidence is thin. |
| **Memory-only** | Prefix: "Previously recorded (not re-verified in this query): …" |
| **Conflict** | State both sides; **evidence wins** for facts; surface conflict explicitly. Do not silently prefer memory. |
| **No evidence, memory yes** | Answer from memory with disclaimer; suggest re-verification or broader search. |
| **Neither** | Say history was not found; do not invent. |

**Prohibited synthesis patterns:**

- Blending memory text into evidence narrative without attribution
- Stating memory content as if it were observed in this query
- Dropping IDs when the user asked for "what we did" or "which sessions"
- Using memory to override evidence on file paths, tool outcomes, or timestamps

**Attune gate:** Only propose `recall_attune` when synthesis is supported by evidence
in the same query (or user explicitly asks to record a conclusion they already approved).

## Scope model

**Default scope = current workspace** for all workspace-bound sessions, **including
Work primary threads**. Work (L5) is orchestration context, not a memory firewall.
Agents need cross-session history within the same repo/workspace even while inside Work.

```text
Default (implicit):
  workspaceId = current session's workspace

Narrow (explicit user intent or query opts only):
  sessionId     — "this conversation", "刚才这条"
  workId        — "在这个 Work 里", "this task only" (opt-in filter)
  issueId       — "在这个 issue 上" (opt-in, after Plan 051)
  origin/import — provenance filter when user asks

Broaden (explicit only):
  cross-workspace / global — user asks or workspace-scoped search returned nothing relevant
```

**Decision table:**

| User intent | Default scope | Narrow filter |
| ----------- | ------------- | ------------- |
| General past work ("上次 auth 怎么修的") | **workspace** | none |
| This chat only | current **session** | `sessionId` |
| Inside Work, no narrowing phrase | **workspace** | none — Work does not restrict |
| "Just this Work / this task" | workspace → filter | `workId` |
| "On this issue" | workspace → filter | `issueId` |
| Imported Claude/Codex only | workspace | `origin=imported` |

`overview()` shows Work/Issue as **orientation** (map), not as an automatic search
filter. Helpers accept optional `workId` / `issueId` / `sessionId` — omit them for
the default workspace-wide recall.

Empty workspace-scoped results are valid. Broaden to global only when the user asks
or workspace scope clearly cannot answer (e.g. cross-repo question).

## Assembly model (L3 vs L4)

```text
Turn start:
  L4 pushes: system + harness(work) + transcript(≤12 msgs / 120k chars)

Mid-turn (agent decides):
  recall_query → tool result appended at tail → agent continues

Never:
  inject recall results into harness fragments or system prompt rebuild
```

Provider compaction may drop recalled evidence from context; agent may re-query —
same assumption as Obelisk.

## Lifecycle model

| Event | L1 | L2 | L3 index |
| ----- | -- | -- | -------- |
| Message completed | update evidence | — | update search projection |
| Run terminal | snapshot events final | — | failures index |
| Session archive/delete | retention policy | unlink or retain per Chronicle rules | purge |
| LastTurnRolledBack | messages removed | — | reindex |
| Attune remember | — | insert memory | memories index |

## Relationship to existing modules

| Existing | Layer | Recall stance |
| -------- | ----- | ------------- |
| `chat-runtime/harness` | L4 | Unchanged; **no** recall injection |
| `chronicle` | L2 (+ L1 activity) | `memories()` reads public projection; attune may write |
| `search` | Human L3 facade today | Becomes one consumer of recall query core OR deprecated gradually |
| `external-session-import` | L1 ingest | Imported sessions indexed same as native |
| `observability` | Ops evidence | Not product recall; may share snapshot reads |
| `javascript-eval` | Sandbox precedent | Reuse managed-process / read-only patterns for `recall_query` |

## Out of scope for this plan

- Obelisk-style external `~/.claude` / `~/.codex` JSONL indexer as primary source
  (import path already exists via `external-session-import`)
- Semantic embeddings in v1 (FTS + structured helpers first)
- Human-only Electron recall browser (may reuse query core later)
- Ambient pre-turn recall or harness auto-injection
- Fine-grained MCP tool per helper (`search_threads`, `get_failures`, …)

## Milestones

### Phase A — Design landing (this PR)

**Goal:** Agent-facing contract in repo; zero runtime behavior change.

Deliverables:

- [ ] This plan (`plans/061-cradle-recall-agent-cognition-stack.md`)
- [ ] Retrieval contract draft (`plans/061-recall-retrieval-contract.md`) — **not** a skill yet
- [ ] Capability spec (`apps/server/specs/capabilities/recall.md`)
- [ ] Row in `plans/README.md`

**Not in Phase A:** `.agents/skills/recall/` — skill installs with Phase B runtime.

**Verification:** Docs review only; no server/web code required.

### Phase B — L3 `recall_query` MVP

**Goal:** In-chat tool executes read-only sandbox; **then** add agent skill.

- New module `recall` (or extend `search` with clear L3 owner — decision at Phase B start)
- Chat runtime registers `recall_query` tool for agent-capable runtimes
- Reuse/adapt `javascript-eval` process sandbox with recall helpers wired to L1 reads
- Promote `plans/061-recall-retrieval-contract.md` → `.agents/skills/recall/SKILL.md`

**Depends on:** Phase A merged; 050 recommended for session scope accuracy.

### Phase C — L1 evidence completeness

**Goal:** Ground truth sufficient for Obelisk-class questions.

- Projector hook: index on message completion (text + tool parts + file paths)
- FTS migration in Drizzle (or `recall_*` tables — decide at Phase C start)
- `failures()`, `fileHistory()` backed by run snapshots + tool part extractor
- Backfill job from existing messages

### Phase D — L2 attune + human facade

**Goal:** Approved synthesis + optional UI.

- `recall_attune` with `remember()` / `forget()` (Chronicle or dedicated attune table)
- Human global search mode consuming same query core
- Provider-thread lazy fetch helper

## STOP conditions

- Phase B starts before Phase A docs merge
- Implementation adds harness context source for recall (ambient recall)
- Implementation exposes helper functions as separate MCP tools without plan amendment
- New write path bypassing domain `public.ts` (violates Plan 041)
- Async CQRS / outbox introduced for indexing (violates Plan 024)

## References

- Obelisk: https://github.com/tommy0103/obelisk (CodeAct, retrieval contract, two-tier runtime)
- Agent design skill: `.claude/skills/agent-design/SKILL.md`
- Plan 024 — synchronous projections, no async CQRS
- Plan 041 — domain ownership, `public.ts` seams
- Plan 050/051 — session/issue projection coherence (scope trust)
