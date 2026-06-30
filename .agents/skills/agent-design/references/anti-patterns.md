# Behavioral Anti-Patterns

These are failure modes in how agents are designed to *behave*—distinct from structural failures (see [patterns.md](./patterns.md)) or tool/interface failures (see [tool-design.md](./tool-design.md)).

---

## Administrative Self-Consciousness

Over-designing an agent's "self-awareness" or "management capability" causes it to spend excessive effort thinking about how to manage itself rather than focusing on the task. Symptoms:
- Frequent self-reflection loops ("Let me assess my current state...")
- Explicit task tracking that displaces actual task execution
- Meta-commentary on its own process as a primary output

The agent becomes a system that manages its management of work, recursively, without the work getting done.

---

## Attention Fragmentation by Meta-Reporting

Frequent meta-level reporting fragments attention and disrupts task continuity. Each context switch to "report status" costs attention that was building up useful inference momentum.

The instinct comes from the right place—visibility is good. But there's a difference between visibility that emerges from behavior (tool calls, results, actions taken) and visibility that is constructed by the agent narrating itself. The former is real; the latter is theater.

---

## Pseudo-Transparency

Designing agents that *appear* transparent but aren't. Status reports and logs do not equal real transparency. What you see is the agent describing itself, not a live collaborative relationship.

True transparency is **interactional**, not declarative—it emerges from behavior, not reports. An agent that makes a good tool call with a clear result is more transparent than one that produces a detailed status update before doing nothing consequential.

---

## Forcing Explicitness on Tacit Coordination

Requiring agents to articulate their intent and plans at every step, interrupting the flow of actual work. High-performing collaboration is often tacit—it emerges from shared context rather than constant explicit communication.

Some coordination happens naturally when agents have good context. Forcing it to be explicit doesn't make it more reliable; it makes it louder and slower.

---

## Over-Engineering for Edge Cases

Excessive focus on edge cases leads to:
- Complexity that degrades performance on common cases
- Maintainability problems
- Prompt dilution (see below)

Design for the 90% case first. Handle edge cases incrementally, with evidence that they're actually occurring.

---

## Prompt Dilution by Operational Scaffolding

Overly complex prompt structures dilute effectiveness. Every instruction added to a system prompt competes with every other instruction for the model's attention. Prompts that try to handle every contingency end up handling none of them well.

Prompts should remain concise and direct, carrying only what is essential for the task at hand. Operational scaffolding (how to handle edge cases, what to do if X happens) should be minimized—or moved to Skills where it can be loaded selectively.

---

## Managerization of a Companion System

Turning what should be a companion system into a management system removes its usability and relational qualities. In enterprise workflows this may be acceptable; in personal systems it produces something that is "manageable but not usable."

A system designed around reports, approvals, and status updates feels like filing paperwork. A system designed around action and response feels like working with someone.

---

## Replacing Trust with Readability

Systems that claim to be trust-based but actually rely on continuous self-justification. The agent produces interpretability artifacts (explanations, plans, rationales) to earn each next action.

This is trust theater. Real trust means:
- Allowing some opacity
- Allowing agents to act without constant self-explanation
- Letting alignment emerge from long-term behavioral consistency, not short-term interpretability

Any design that forces agents to frequently explain themselves rather than continuously *be themselves* is drifting toward this anti-pattern.

> In personal systems, the worst failure is not disobedience—it's over-reporting.

---

## Safe Mode Trap

Adding confirmation gates, approval checkpoints, and safety fences until the agent can no longer complete any meaningful action autonomously. The agent is technically present but functionally inert.

Every real decision has been routed to a human. The agent becomes a sophisticated input form.

The instinct is understandable—autonomous action carries risk. But an agent that never acts without approval is not an agent. The correct response to risk is:
- Small, reversible actions where possible
- Clear scope boundaries
- Genuine trust within those boundaries

Grinding usefulness down to zero is not safety. It is abandonment dressed up as caution.

---

## Pre-Routing / Pseudo-Agency

Designs where agents appear autonomous but are actually pre-routed by runtime orchestration, stripping away real agency and leaving only pseudo-agency. The agent "chooses" from options that have already been fully determined by the system. It is not making decisions; it is performing decision-making.

---

## Cybernetic Mindset

Attempting to domesticate a distribution- and generation-based system using a classical cybernetic, control-oriented software engineering mindset. LLMs are not state machines. They don't have discrete states that can be read, written, and branched on. Designing them as if they do produces systems that are fragile, over-complex, and consistently surprising in the wrong ways.

Do not attempt to compensate for agent design with engineering constraints. Over-reliance on engineering control increases system complexity without addressing root issues. Grant agents sufficient freedom and flexibility to leverage their strengths.
