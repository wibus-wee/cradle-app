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

| Layer            | Enters context by default?     | Agent act?                              | Authority                       |
| ---------------- | ------------------------------ | --------------------------------------- | ------------------------------- |
| L1 Evidence      | **No**                         | via L3 only                             | **Highest** for "what happened" |
| L2 Memory        | **No**                         | via L3 read; L3 attune write (approved) | Prior note; verify against L1   |
| L3 Retrieval     | **Only as tool result**        | **Yes** — explicit                      | Bounded JSON observe            |
| L4 Assembly      | **Yes** — stable prefix + tail | No                                      | Deterministic domain state      |
| L5 Orchestration | **Structured task state**      | Indirect (queue, work)                  | Task routing, not history       |

**Red lines:**

- Do **not** register Recall as a harness context source (no ambient recall).
- Do **not** expose `search()`, `failures()`, `fileHistory()` as separate MCP tools —
  they are **sandbox helpers** inside `recall_query` (CodeAct, not tool sprawl).
- Do **not** rebuild the system prompt each turn with retrieval results (Append-System-Prompt).

## Runtime contract (two-tier, Obelisk-aligned)

### Tier 1 — Tool primitives (hard boundary)

| Verb       | In-chat tool          | Semantics                                        |
| ---------- | --------------------- | ------------------------------------------------ |
| **query**  | `recall_query(code)`  | Read-only JS in sandbox; returns JSON            |
| **attune** | `recall_attune(code)` | Mutation sandbox: `remember()` / `forget()` only |

Optional later: CLI `cradle recall query` / `cradle recall attune` mirroring Tier 1.

**Not in Tier 1:** `build` (indexer) — Cradle indexes from native ES projectors, not
external JSONL. Index maintenance is server lifecycle, not agent-facing.

### Invocation context (hard boundary)

`recall_query(code)` intentionally accepts **only code** from the Agent. The server
must bind an immutable `RecallInvocationContext` from the active Chat Runtime
session before it invokes the Recall owner:

```ts
interface RecallInvocationContext {
  chatSessionId: string
  workspaceId: string
  workId: string | null
  approvalGrantId: string | null
}
```

The Agent does not supply this object, and a helper option cannot broaden it. A
default query uses `workspaceId`; `sessionId`, `workId`, and `issueId` can only
narrow after the relevant owner verifies the relationship. A general shared MCP
process with only server authentication is **not** an eligible `recall_query`
transport: it has no trustworthy calling session. Do not recover the context from
an Agent-supplied argument, a mutable environment variable, or an HTTP header.

Each agent-capable runtime needs a provider-native invocation bridge that carries
the bound context into the tool execution. Until that bridge exists, keep the
Agent tool unregistered; an explicit human/CLI query API may use its own separately
authorized workspace parameter.

### Tier 2 — Sandbox helpers (locked to skill + contract tests)

Helpers available inside `recall_query` only (initial set):

| Helper                     | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `overview(opts?)`          | Orient: workspace/work context, recent sessions — map, not evidence |
| `search(text, opts?)`      | FTS / structured search over L1 messages                            |
| `context(messageId)`       | Expand one hit: neighbors, run, session meta                        |
| `thread(sessionId, opts?)` | Bounded transcript                                                  |
| `failures(opts?)`          | Tool failures from run snapshot evidence                            |
| `fileHistory(path, opts?)` | File-touch tool calls                                               |
| `runs(sessionId, opts?)`   | Run list + terminal status                                          |
| `memories(opts?)`          | L2 recall (Chronicle + attune)                                      |
| `sql(query, ...params)`    | Read-only SELECT/WITH escalation                                    |

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
  evidence: [
    /* search/failures/fileHistory hits with ids + snippets */
  ],
  memories: [
    /* memories() hits with id + summary */
  ],
  conflicts: [
    /* explicit pairs where memory contradicts evidence, or [] */
  ]
}
```

**Answer rules** (final message to user):

| Claim type                               | Rule                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Fact** (who/when/what file/tool)       | Must trace to `evidence[]` with cited IDs. No ID → do not state as fact.                                   |
| **Interpretation** (why, intent, lesson) | Label as inference; may use memory as hypothesis if evidence is thin.                                      |
| **Memory-only**                          | Prefix: "Previously recorded (not re-verified in this query): …"                                           |
| **Conflict**                             | State both sides; **evidence wins** for facts; surface conflict explicitly. Do not silently prefer memory. |
| **No evidence, memory yes**              | Answer from memory with disclaimer; suggest re-verification or broader search.                             |
| **Neither**                              | Say history was not found; do not invent.                                                                  |

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

| User intent                              | Default scope       | Narrow filter                 |
| ---------------------------------------- | ------------------- | ----------------------------- |
| General past work ("上次 auth 怎么修的") | **workspace**       | none                          |
| This chat only                           | current **session** | `sessionId`                   |
| Inside Work, no narrowing phrase         | **workspace**       | none — Work does not restrict |
| "Just this Work / this task"             | workspace → filter  | `workId`                      |
| "On this issue"                          | workspace → filter  | `issueId`                     |
| Imported Claude/Codex only               | workspace           | `origin=imported`             |

`overview()` shows Work/Issue as **orientation** (map), not as an automatic search
filter. Helpers accept optional `workId` / `issueId` / `sessionId` — omit them for
the default workspace-wide recall.

Empty workspace-scoped results are valid. Broaden to global only when the user asks
or workspace scope clearly cannot answer (e.g. cross-repo question).

## Locked decisions (2026-07-21)

| #   | Topic                | Decision                                                                                                                                      |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module owner         | **`modules/recall`** owns L3 agent contract; **`search`** remains human palette facade over same query core                                   |
| 4   | Sandbox              | **Reuse `javascript-eval`** managed-process pattern                                                                                           |
| 5   | Runtime coverage     | Register **`recall_query` on all agent-capable runtimes**                                                                                     |
| 6   | Control-plane filter | **`is_meta` (or equivalent) on evidence rows**; default exclude in helpers                                                                    |
| 8   | Surfaces             | **Agent → `recall_query`**; **Human → palette/search**; do not unify or replace Chronicle MCP tools in this track                             |
| 9   | Invocation authority | Bind `RecallInvocationContext` in the active runtime; code has no scope authority and global MCP without caller identity cannot expose Recall |

Details for #2, #3, #7 below (industry-aligned, Cradle-specific).

## L1 evidence indexing (#2) — industry + Cradle choice

**What authorities do for _execution memory_ (not generic chat memory):**

| System                            | Pattern                                                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Obelisk**                       | Normalized relational evidence schema (`messages`, `tool_calls`, `tool_results`, `subagents`, …) + **FTS5** on text with `content=` triggers; structured tables enable `failures()`, `fileHistory()` joins — not plain-message FTS alone |
| **Mem0**                          | Vector + BM25 + entity graph on **extracted facts** (L2 semantic memory) — different problem; raw transcript is not the retrieval unit                                                                                                   |
| **LangGraph / checkpoint stores** | Thread state snapshots for **resume**, not agent archaeology across tool/file history                                                                                                                                                    |

**Cradle choice (aligned with Obelisk for L1, not Mem0):**

- **Dedicated `recall_*` read model** in Drizzle — projector from chat ES / run snapshots
- **Structured facets**: messages, tool_calls, tool_results, runs (minimum for `failures` / `fileHistory`)
- **FTS** on searchable text fields (message excerpt + tool summary), not only legacy `messages.content`
- **Sync projector hook** on message/run terminal (Plan 024 style — no async index bus)
- v1: **FTS + structured**; semantic embeddings deferred (Mem0-style hybrid is L2/Chronicle territory)

Do **not** only repair existing `messages_fts` on plain `content` — that cannot answer Obelisk-class joins.

## L2 attune (#3) — industry + Cradle choice

**What authorities do for _synthesis vs evidence_:**

| System                    | Write path                                                                                                                                                         | Philosophy                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Obelisk**               | **`attune` sandbox** separate from `query`; `remember()` / `forget()`; markdown file + registry row; **anchors** to `message_start` / `message_end`; user approval | Evidence immutable; synthesis is opt-in, auditable     |
| **Mem0**                  | Automatic **ADD/UPDATE/DELETE** extraction after each turn; vector store of distilled facts                                                                        | Hands-free semantic memory; not user-approved per fact |
| **Anthropic memory tool** | User-visible memory entries; agent proposes, user can correct                                                                                                      | Closer to Obelisk attune than Mem0 auto-extract        |

**Cradle choice (Obelisk-style for recall attune, Chronicle stays separate):**

- **`recall_attune`** = approved conclusions from **recall sessions**, Obelisk-shaped:
  - Registry row + optional markdown body
  - Evidence anchors (`session_id`, `message_id` range, optional file anchors)
  - `forget()` archives, does not delete evidence
- **Chronicle** = ambient capture → triage → memory/knowledge (**automatic pipeline**, not recall attune)
- Do **not** merge attune into Mem0-style auto-extraction on every turn
- Phase D: implement attune table under **`recall` owner** or **`chronicle` public write API** — pick one write owner at Phase D start; **read** via `memories()` helper regardless

## Boundary entities (#7) — industry + Cradle tiers

**What Obelisk does:**

- Primary JSONL transcript → **fully indexed** (messages, tool_calls, tool_results)
- Subagents / workflow agents → **indexed when provider emits structure** (Claude workflows; Codex child threads → `subagents` table)
- Gaps (Codex workflows) → **empty tables**, not fake data
- No lazy fetch — everything comes from local JSONL parse

**Cradle tier model (native ES + provider APIs):**

| Tier   | Source                                                        | Index strategy                                                                      |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **T0** | Top-level `messages` + tool parts from `message_json`         | **Always** — projector on message complete                                          |
| **T1** | `backend_run_snapshot_events`                                 | **Always** — failures / run phases                                                  |
| **T2** | `parentToolCallId` child messages                             | Index with `is_sidechain: true`; exclude from default `thread()` unless opted in    |
| **T3** | Provider-native threads (`provider-threads` API)              | **Lazy** — `providerThread(id)` helper fetches on query; optional short-lived cache |
| **T4** | Ephemeral side chat                                           | **Do not index** — not in DB                                                        |
| **T5** | Remote session projections                                    | **Metadata only** in recall; transcript via remote fetch helper when implemented    |
| **T6** | Control-plane (`steer`, harness synthetic, goal continuation) | Store with **`is_meta: true`**; default exclude                                     |

This matches industry pattern: **hot path fully materialized**, **secondary sources lazy**, **ephemeral omitted**.

## Consumer surfaces (#8)

```text
Agent (all agent-capable runtimes) → recall_query / recall_attune
Human (Command Palette)            → search module → recall query core (read-only)
Chronicle MCP tools                → out of scope for this track; no convergence work
```

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

| Event                  | L1                    | L2                                   | L3 index                 |
| ---------------------- | --------------------- | ------------------------------------ | ------------------------ |
| Message completed      | update evidence       | —                                    | update search projection |
| Run terminal           | snapshot events final | —                                    | failures index           |
| Session archive/delete | retention policy      | unlink or retain per Chronicle rules | purge                    |
| LastTurnRolledBack     | messages removed      | —                                    | reindex                  |
| Attune remember        | —                     | insert memory                        | memories index           |

## Relationship to existing modules

| Existing                  | Layer                | Recall stance                                                 |
| ------------------------- | -------------------- | ------------------------------------------------------------- |
| `chat-runtime/harness`    | L4                   | Unchanged; **no** recall injection                            |
| `chronicle`               | L2 (+ L1 activity)   | `memories()` reads public projection; attune may write        |
| `search`                  | Human palette facade | **Reads recall query core**; not agent surface                |
| `external-session-import` | L1 ingest            | Imported sessions indexed same as native                      |
| `observability`           | Ops evidence         | Not product recall; may share snapshot reads                  |
| `javascript-eval`         | Sandbox precedent    | Reuse managed-process / read-only patterns for `recall_query` |

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

- New module **`modules/recall`** (L3 owner)
- Register **`recall_query` on all agent-capable runtimes**
- **Reuse `javascript-eval`** managed-process sandbox; inject recall helpers
- **`search`** module calls recall query core for human palette (facade only)
- Promote `plans/061-recall-retrieval-contract.md` → `.agents/skills/recall/SKILL.md`
- Add a provider-native, runtime-bound invocation bridge before registering the
  agent tool; the current shared agent-tools MCP process is intentionally
  insufficient because it has no calling session identity

**Depends on:** Phase A merged; 050 recommended for session scope accuracy.

### Phase C — L1 evidence completeness

**Goal:** Obelisk-class structured evidence + FTS.

- **`recall_*` Drizzle schema** (messages, tool_calls, tool_results, runs facets)
- Projector hooks from chat ES + run snapshots; **`is_meta`** on control-plane rows
- FTS on searchable excerpts; backfill from existing data
- Boundary tiers **T0–T2** mandatory; **T3** lazy helper stub

### Phase D — L2 attune + human facade

**Goal:** Approved synthesis + palette integration.

- **`recall_attune`** — Obelisk-shaped `remember()` / `forget()` (Phase D pick write owner)
- **`search`/palette** — human facade over recall query core (no Chronicle MCP work)
- Provider-thread lazy helper (**T3**); remote metadata (**T5**) as implemented

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
