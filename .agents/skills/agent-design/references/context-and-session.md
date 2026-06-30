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
