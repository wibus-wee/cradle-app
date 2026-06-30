# Evaluation & Verification

## What Makes a Good Agent Design?

Agent design quality is not primarily evaluated by how elegant the architecture looks—it's evaluated by how the agent actually behaves in use. The signals are behavioral.

**Signals of a healthy design:**
- The agent completes tasks with fewer interruptions than expected
- Errors are caught from environment feedback and corrected without human intervention
- The agent uses tools in combinations that weren't explicitly anticipated by the designer
- Conversations feel like working *with* someone, not filing requests *to* a system

**Signals of a drifting design:**
- Agents produce more status reports than tool calls
- Tasks require constant human steering to make progress
- Failures are opaque—it's unclear why the agent did what it did
- Adding more instructions makes things worse, not better

---

## Environment as the Verification Signal

The primary verification mechanism for an agent in a loop is **environmental feedback**—actual tool call results. Not the agent's stated plan, not its self-assessment, not a human review at each step.

The loop is: act → observe result → act again.

If you find yourself inserting human verification between every step, you've exited the agent loop and entered a supervised workflow. That's sometimes correct (high-stakes, irreversible actions) but should be a deliberate choice, not the default.

**When to insert human checkpoints:**
- Before irreversible actions (deleting data, sending messages, making purchases)
- When the agent has explicitly surfaced uncertainty about a decision
- At natural task boundaries, not at every micro-step

---

## Evaluating Tool Design

A tool is well-designed if an agent uses it correctly without needing to be told how. Test this empirically:

1. Give the agent a task that requires the tool
2. Observe whether it calls the tool correctly on the first attempt
3. If not: is the error from tool design (wrong parameters, unclear description) or from task understanding?

Common tool design failures:
- Parameter names that are ambiguous or overlap with similar tools
- Descriptions that explain *what* the tool does but not *when* to use it vs alternatives
- Missing information about expected output format or error signals
- Paths, IDs, or references that require the agent to know context it doesn't have (→ prefer absolute paths over relative)

---

## Evaluating Skill Design

A Skill is working if the agent behavior it governs is reliable and appropriate to context.

For a **knowledge Skill**: does the agent apply the knowledge correctly in novel situations, or only when the situation matches the examples literally?

For a **workflow Skill**: does the agent follow the workflow when appropriate and *deviate* when the situation genuinely calls for it? A workflow that is followed blindly regardless of context has become a constraint, not a guide.

For a **tool integration Skill**: does the agent use the tool in the right situations with appropriate parameters, without the tool needing to be wrapped in a narrower interface?

---

## Red Flags in Design Review

When reviewing an agent design, watch for:

| Observation | Likely Issue |
|-------------|-------------|
| Tool with many required structured parameters | Possible Interface Wrapping—should this be a Skill? |
| Agent produces long plans before every action | Administrative Self-Consciousness |
| State stored in database, injected back into context | State Externalization Fallacy |
| Every action requires human approval | Safe Mode Trap |
| Single agent routes all decisions for all other agents | Orchestration Gravity |
| System prompt is longer than 2000 words | Prompt Dilution—what can move to Skills? |
| Agent explains why it's about to do something before doing it | Forcing Explicitness / Meta-Reporting |
