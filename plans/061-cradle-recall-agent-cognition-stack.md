# Plan 061: Cradle Recall — Agent Cognition Stack and CodeAct retrieval

> **Executor instructions**: This plan is **design-first**. Phase A (this document +
> capability spec + skill contract) must land before any runtime implementation.
> Follow milestones in order; honor STOP conditions. When Phase A is merged, update
> the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat HEAD -- plans/061-cradle-recall-agent-cognition-stack.md apps/server/specs/capabilities/recall.md .claude/skills/recall`
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
2. **L2 Memory** is a prior note — agent must say it was "previously recorded" and
   compare with L1 when correctness matters
3. **Agent synthesis** must cite stable IDs (`session_id`, `message_id`, `run_id`,
   `tool_call_id`) from L3 results

Skill must teach: **Evidence before conclusion**; compact JSON ideally under 10k–12k
chars for synthesis tasks.

## Scope model

Default retrieval scope (narrowest first):

```text
1. Current session (if question is about "this conversation")
2. Current Work container sessions (if session is Work-scoped)
3. Current Issue-linked sessions (after Plan 051)
4. Current workspace
5. Global (explicit broaden only)
```

`overview()` establishes scope before deep retrieval. Empty scoped results are valid
unless the user asked to broaden.

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
- [ ] Capability spec (`apps/server/specs/capabilities/recall.md`)
- [ ] Agent skill (`.claude/skills/recall/SKILL.md` + `references/retrieval-contract.md`)
- [ ] Row in `plans/README.md`

**Verification:** Docs review only; no server/web code required.

### Phase B — L3 `recall_query` MVP

**Goal:** In-chat tool executes read-only sandbox; skill teaches usage.

- New module `recall` (or extend `search` with clear L3 owner — decision at Phase B start)
- Chat runtime registers `recall_query` tool for agent-capable runtimes
- Reuse/adapt `javascript-eval` process sandbox with recall helpers wired to L1 reads
- Skill triggers on explicit user/agent recall intent

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
