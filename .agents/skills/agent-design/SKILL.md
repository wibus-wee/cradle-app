---
name: agent-design
description: design and review llm agent systems, tool interfaces, and skill boundaries. use when chatgpt needs to decide whether a task should be handled by a prompt, workflow, skill, tool, single-agent loop, or multi-agent system; define tool schemas, instructions, guardrails, evaluation plans, or permission boundaries; or critique an existing agent design for over-orchestration, weak context handling, missing verification, or poor tool design.
---

# Agent Design Skill

## Core Principles

Three axioms everything else derives from:

1. **Tools are primitive system boundaries.** They expose raw capabilities without encoding usage assumptions.
2. **Skills are usage knowledge.** They teach the agent when and how to wield those primitives—as knowledge, workflows, CLI wrappers, delegation patterns, or tool integration guides.
3. **The context window is real state.** Everything else is a projection.

## Quick Decision Rules

**Tool or Skill?**
- New system boundary (shell, filesystem, web, external API) → **Tool**
- Teaching the agent to use an existing capability reliably → **Skill**
- See [decision-tree.md](./references/decision-tree.md) for full breakdown

**Workflow or Agent loop?**
- Subtasks are predictable and fixed-order → **Workflow**
- Path depends on prior results and can't be hardcoded → **Agent**

**Single-agent or Multi-agent?**
- One context window is sufficient → **Single**
- Tasks are genuinely independent, or require specialized context separation → **Multi**
- When in doubt, start single. See [patterns.md](./references/patterns.md)

**When to add orchestration?**
- Only when simpler structures demonstrably fail. Never for architectural elegance alone.

## Red Flags

If you see any of these, the design has likely drifted:
- A tool that encodes "how to use it" in its interface → [Interface Wrapping](./references/tool-design.md)
- An agent that reports its state more than it acts → [Meta-Reporting](./references/anti-patterns.md)
- A coordinator that every agent must ask before doing anything → [Orchestration Gravity](./references/patterns.md)
- Approval gates on every meaningful action → [Safe Mode Trap](./references/anti-patterns.md)
- External database treated as the agent's real state → [State Externalization Fallacy](./references/context-and-session.md)

## References

| Topic | File |
|-------|------|
| When to use Tool vs Skill vs Workflow vs Agent | [decision-tree.md](./references/decision-tree.md) |
| Tool design & ACI | [tool-design.md](./references/tool-design.md) |
| Context, state & session management | [context-and-session.md](./references/context-and-session.md) |
| Orchestration & structural patterns | [patterns.md](./references/patterns.md) |
| Behavioral anti-patterns | [anti-patterns.md](./references/anti-patterns.md) |
| Evaluation & verification | [evals-and-verification.md](./references/evals-and-verification.md) |
| What is Skills? | [What-is-skills.md](./references/What-is-skills.md) |
