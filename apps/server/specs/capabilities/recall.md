# Capability: Recall (Cradle execution memory)

## Status

- 📝 **SPEC Written** (Plan 061 Phase A)
- 🚧 Implementing — not started

## User / System Goal

Agents running inside Cradle need **explicit execution memory**: query past sessions,
tool failures, file edit history, and approved conclusions — on demand, with citable
evidence — without ambient pre-turn injection.

Inspired by [Obelisk](https://github.com/tommy0103/obelisk) agent design (CodeAct +
retrieval contract), adapted to Cradle-native facts (`session_events`, payloads, run
snapshots, Chronicle memory).

## Agent Cognition Position

Recall is **Layer 3 (Retrieval)** in the Cradle Agent Cognition Stack. It reads:

- **L1 Evidence** — chat messages, tool parts, run snapshot events, provider threads
- **L2 Memory** — Chronicle memories, knowledge cards, attune records

It does **not** replace:

- **L4 Context Assembly** (harness, transcript)
- **L5 Orchestration** (Work, Issue, Queue)
- Human **Search** palette (may share query core later)

See `plans/061-cradle-recall-agent-cognition-stack.md` for the full stack.

## Target Agent Interface (Tier 1)

| Tool            | Mode      | Description                                            |
| --------------- | --------- | ------------------------------------------------------ |
| `recall_query`  | Read-only | Agent supplies JS; sandbox returns JSON                |
| `recall_attune` | Mutation  | `remember()` / `forget()` only; user approval required |

Helpers (`search`, `overview`, `failures`, …) exist **inside** the query sandbox only —
not as separate MCP tools.

`recall_query` receives the current workspace/session from a trusted runtime-bound
invocation context, not from the Agent's code or tool arguments. Helper filters can
only narrow that scope. The existing shared `agent-tools` MCP process has no caller
session identity, so it cannot register Recall until a provider-native invocation
bridge exists. This restriction prevents a model from self-authorizing a different
workspace by passing an ID.

## Target HTTP / CLI (optional, Phase B+)

- `POST /recall/query` — server-side sandbox (same contract as in-chat tool)
- `POST /recall/attune` — attune sandbox
- `cradle recall query --file …` — CLI transport

OpenAPI + `x-cradle-cli` when routes land.

## Evidence Sources (L1)

| Source                               | Owner module            | Recall access                     |
| ------------------------------------ | ----------------------- | --------------------------------- |
| `messages` + `chat_message_payloads` | chat-runtime            | Read via public query API         |
| `backend_run_snapshot_events`        | chat-runtime            | Read failures/phases              |
| `sessions` metadata                  | session                 | Scope filters                     |
| Provider thread transcripts          | chat-runtime            | Lazy fetch helper (Phase D)       |
| External import sessions             | external-session-import | Same as native after import       |
| Chronicle activity segments          | chronicle               | Optional deep evidence (Phase C+) |

Recall module **reads** via owner `public.ts` — no cross-domain table writes.

## Memory Sources (L2)

| Source                     | Owner                             | Recall access                          |
| -------------------------- | --------------------------------- | -------------------------------------- |
| Chronicle memories / cards | chronicle                         | `memories()` helper                    |
| Attune records             | recall or chronicle (TBD Phase D) | `memories()` + `remember()`/`forget()` |

Authority: L1 evidence > L2 memory for factual claims.

## Non-Goals (v1)

- External JSONL indexer (`~/.claude`, `~/.codex`) as primary pipeline
- Harness auto-injection of recall results
- Separate MCP tool per helper
- Semantic vector search (FTS + structured first)

## Module ownership

- **Owner:** `modules/recall` — L3 agent contract, sandbox, attune (Phase D)
- **Facade:** `modules/search` — human palette; delegates to recall query core
- **Evidence writers:** chat-runtime projectors → recall ingest (read model only)
- **Invocation bridge:** each agent runtime derives immutable `RecallInvocationContext`
  from the active Chat Runtime session before calling the Recall owner

## Overlap with Search Module

| Surface                     | Owner                                        |
| --------------------------- | -------------------------------------------- |
| Agent `recall_query`        | recall                                       |
| Human `@` threads / palette | search → recall core                         |
| Chronicle MCP               | **Unchanged**; out of scope for recall track |

## Test Plan (when implementing)

- Sandbox rejects non-SELECT SQL and filesystem writes in `recall_query`
- `recall_attune` rejects helpers available in query mode
- Helper return shapes match skill contract (golden fixtures)
- Scoped search returns empty without throwing when scope is valid-but-empty
- Session delete/archive purges recall index rows
- No harness fragment registered for recall (grep guard)

## Related Documents

- Plan: `plans/061-cradle-recall-agent-cognition-stack.md`
- Retrieval contract (draft, pre-skill): `plans/061-recall-retrieval-contract.md`
- Agent design: `.agents/skills/agent-design/SKILL.md`
