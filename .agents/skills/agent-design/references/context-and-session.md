# Context, State & Session Management

## The Context Window Is Real State

An agent's real state lives in its context window—the accumulated inference pressure of everything it has seen and generated. This is not a metaphor. The model's behavior at any point is determined by the full context, not by any external record you maintain.

**Implications:**
- What the agent *can do* is determined by what it currently *carries in context*
- Context health—right information present, stale information retired, ambient task pressure maintained—is more fundamental than managing external state or designing elaborate logging systems
- The "feel" of a task, the role, the stylistic constraints—these live in context as accumulated pressure, not as discrete stored variables

---

## State Externalization Fallacy

The belief that moving an agent's state into an external system (database, workflow engine, state machine) gives you control over it.

It doesn't.

What you store externally is a **projection** of the agent's state—a lossy snapshot of natural language inference. External state is useful for:
- Persistence across sessions
- Human inspection and audit
- Inter-agent communication of results

But it is always a shadow of the real state, never the real state itself. Designing *around* the shadow instead of the substance leads to agents that are observable but not actually governable.

**The restoration problem:** Trying to resume agent state by injecting stored external state back into context is a reconstruction attempt on a lossy projection. You are not resuming cognition. You are creating a new agent that has been told a story about a previous one. It will behave accordingly—sometimes well, sometimes with subtle discontinuities no one can explain.

---

## Status Snapshot Anti-Pattern

Designing agents that rely heavily on snapshotting the entire state at each turn—producing explicit status reports before proceeding.

The core error is mistaking an agent as a "sliceable object" instead of a continuously shaped process. What matters is not the management view, but the preservation of *potential energy*.

The best agent interactions are not driven by state reports, but by:
- An unspoken yet persistent task atmosphere
- A vague but stable sense of role
- Stylistic inertia formed under long-term prompt constraints

State exists in natural language descriptions, not in structured, verifiable, executable data models. Attempting to extract structured state from natural language, then reconstruct it later, is lossy compression followed by approximate reconstruction—an entropy-increasing anti-pattern.

---

## Context Quality in Practice

Things that degrade context quality:
- Accumulated tool outputs that are no longer relevant
- Repeated meta-level status reports filling the window
- Injected structured state that doesn't read naturally to the model
- Over-long system prompts that dilute the actual task signal

Things that maintain context quality:
- Compaction: summarizing completed work rather than keeping raw history
- Selective retention: keeping only results that bear on what comes next
- Ambient task pressure: ensuring the core goal remains present and alive in context, even as history grows
- Clean handoffs: when resuming a task, reconstructing context as a coherent narrative, not a data dump

---

## Cache-Friendly Context Architecture

Most agent systems get context assembly wrong. They rebuild the entire system prompt each turn—concatenating stable instructions with volatile state (mode, goal, progress, timestamps). This is the **append-system-prompt** anti-pattern: treating the system prompt as a mutable buffer that gets reconstructed from scratch every turn.

The result: every state change invalidates the entire KV cache prefix. The model recomputes attention over tokens it has already seen, burning latency and compute for no reason.

### How KV Cache Works

Transformer inference caches computed key-value pairs for each token in the prefix. On the next request, if the first N tokens are identical, those cached states are reused—skipping N tokens of computation. Cache hit is strictly left-to-right: any change at position K invalidates everything from K onward.

This makes **prefix stability** the single most important optimization lever for agent context design.

### The Anti-Pattern: Rebuilt System Prompt

```
Turn 1: [system: base_instructions + mode=A + goal=G1 + ts=100]
Turn 2: [system: base_instructions + mode=B + goal=G2 + ts=101]
```

Every turn, the runtime regenerates the system prompt with current state. Even if only `mode` changed, the entire prefix shifts—timestamps, goal text, field ordering—and the cache is fully invalidated. Cost grows linearly with prefix length.

### The Correct Pattern: Append-Only State Transitions

Design context as an immutable, append-only sequence. Stable content lives in a fixed prefix. State changes are appended as new messages, not used to rewrite existing ones.

```
[system: tools + base instructions]     ← fixed, always cached
[developer: mode=A, goal=G1]            ← state snapshot
[user / assistant / tool: conversation] ← grows at tail
...
[developer: mode=B, goal=G2]            ← appended on change
```

The prefix up to the state change is still cached. Only from the new developer message onward does the model recompute. The latest message of a given type supersedes earlier ones—supersession by recency, not by deletion.

### Design Rules

1. **Order by volatility.** Most stable content first: tool definitions → base instructions → rarely-changing config → per-session state → per-turn state.
2. **Never rewrite what can be appended.** If the system prompt is identical across turns, it caches. If it changes every turn, it doesn't. It's that simple.
3. **State transitions are append-only.** New state message goes after the old one. The model reads the latest as authoritative. Do not delete or rewrite the old state message.
4. **Don't inject nonces into stable positions.** Timestamps, random IDs, run hashes—anything that changes every turn—must not appear in the prefix. They destroy cache locality.
5. **Keep the system prompt boring.** If the system prompt varies per-request (per-user, per-goal, per-mode), it can't cache. Move volatile content to developer or user messages where it naturally belongs at the tail.

### Compaction as Context Epoch

Compaction—summarizing history into a shorter form—creates a new context epoch. The prefix changes; cache is expected to miss once. This is acceptable if compaction is infrequent. Design compaction to produce a stable result so subsequent turns benefit from cache again.

The mistake is compacting too aggressively or too frequently, turning every few turns into a cache miss. The goal is long stretches of identical prefix punctuated by intentional, infrequent resets.
