# Orchestration & Structural Patterns

## Minimal Viable Orchestration

Prefer the simplest compositional structure that achieves the goal. Add orchestration layers only when they demonstrably improve outcomes—not because they feel like good architecture.

Every additional layer of coordination is a bet that the coordination cost is worth the benefit. The most capable production agent systems found in the wild are almost always simpler than their designers expected.

**The escalation ladder (use the lowest rung that works):**

1. Single LLM call with good context
2. Prompt chaining (fixed sequential steps)
3. Parallelization (independent subtasks)
4. Orchestrator-workers (dynamic subtask decomposition)
5. Full autonomous multi-agent loop

Move up only when you have evidence the current level is failing, not when the next level feels more powerful.

---

## Orchestration Gravity

Complex multi-agent systems naturally evolve toward a **single central coordinator** that knows all, routes all, and synthesizes all. This feels like good architecture—single point of control, clear responsibility. It isn't.

The central orchestrator becomes:
- The **bottleneck**: all decisions funnel through it
- The **knowledge sink**: all information must be legible to it
- The **single point of failure**: its degradation cascades everywhere

True multi-agent value emerges from **local competence** and **loose coupling**: each agent acts intelligently within its scope, communicating results rather than requesting permission.

> Signal that orchestration gravity has set in: an agent needs to ask the orchestrator "what should I do next?" before every action. At that point, the "agent" is a remote procedure call with extra steps.

**What orchestration should and shouldn't do:**
- ✓ Structural coordination: routing tasks to appropriate agents, synthesizing independent results
- ✓ Input/output handling: transforming messages between agents
- ✗ Semantic decision-making: deciding *how* a worker should approach its task
- ✗ Micro-management: approving each step a worker takes

---

## Skills Structural Patterns

Skills legitimately take many forms. Choosing the right form matters:

| Form | Use when |
|------|----------|
| **Knowledge package** | Agent needs to understand domain concepts, constraints, or context to act well |
| **Step-by-step workflow** | Task has a reliable sequence that should be followed consistently |
| **CLI wrapper** | Agent needs to use a command-line tool with specific invocation patterns |
| **Delegation pattern** | Agent needs to know when/how to hand off to another agent or tool |
| **Tool integration guide** | Agent needs to use a raw tool (bash, web, fs) in a specific way for a specific domain |

The key question is always: is this usage knowledge living in the right layer? If the "how to use this" is baked into the tool interface rather than the Skill, it's Interface Wrapping (→ see [tool-design.md](./tool-design.md)).

---

## When Orchestrator-Workers Is Appropriate

The orchestrator-workers pattern is well-suited when:
- Subtasks are dynamic—you can't predict their number or nature before execution
- Workers genuinely specialize—they need different context or capabilities
- Results need synthesis—worker outputs must be combined into a coherent whole

It is **not** appropriate when:
- You just want to feel like you have a sophisticated system
- Workers could coordinate directly without funneling through the orchestrator
- The orchestrator is doing more cognitive work than the workers
