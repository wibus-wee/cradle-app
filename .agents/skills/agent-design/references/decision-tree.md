# Decision Tree: Tool vs Skill vs Workflow vs Agent

## The Fundamental Split: Tool or Skill?

A **Tool** is a new primitive capability the agent doesn't have yet—a system boundary crossing:
- Shell execution
- Filesystem read/write
- HTTP requests / web search
- Database access
- External API calls

A **Skill** is usage knowledge about capabilities that already exist:
- How to use `bash_tool` to run Claude Code
- When and how to use the browser tool for research
- The workflow for creating a PR in a specific repo
- How to delegate to a sub-agent and synthesize results

**The test:** If the agent had this capability removed, would it lose access to a class of system resources (Tool), or lose knowledge about how to use existing resources (Skill)?

Skills can take any form: knowledge packages, step-by-step workflows, CLI wrappers, delegation patterns, tool integration guides. All are valid.

---

## Workflow or Agent Loop?

**Use a Workflow (predefined code path) when:**
- Subtasks are fully known in advance
- Order is fixed and doesn't depend on intermediate results
- Predictability and consistency matter more than flexibility
- The task can be decomposed cleanly before execution starts

**Use an Agent loop (LLM-directed) when:**
- You can't predict the subtasks needed before execution begins
- Each step's output shapes what the next step should be
- The problem is open-ended: unknown number of steps, unknown path
- Flexibility and model-driven decision-making are required

> From Anthropic's production experience: "Workflows offer predictability and consistency for well-defined tasks, whereas agents are the better option when flexibility and model-driven decision-making are needed at scale."

---

## Single-Agent or Multi-Agent?

**Start with single-agent.** Multi-agent adds coordination overhead and introduces failure modes (Orchestration Gravity, state synchronization). Only move to multi-agent when:

- Tasks are **genuinely independent**—they don't share state and can proceed in parallel without coordination
- Tasks require **specialized context separation**—different long-running contexts that would pollute each other
- **Scale** requires distributing work that a single context window can't handle

**Signals that multi-agent is the wrong answer:**
- You're using multi-agent because it "feels more capable"
- Agents spend more time coordinating than acting
- A central orchestrator is making all substantive decisions (→ see [patterns.md](./patterns.md))

---

## When to Add Orchestration?

Only when simpler structures demonstrably fail.

| Pattern | Use when |
|---------|----------|
| Single LLM call | Task is well-scoped, context fits, one pass is enough |
| Prompt chaining | Task decomposes into fixed sequential steps with gates |
| Parallelization | Independent subtasks, or need diverse perspectives on same input |
| Orchestrator-workers | Subtasks are dynamic—number and nature unknown until runtime |
| Evaluator-optimizer | Clear quality criteria + iterative refinement has measurable value |
| Full autonomous agent | Open-ended, unknown number of steps, trusted environment |

The decision is always: **simplest structure that demonstrably works**. Never add a layer for architectural elegance.
