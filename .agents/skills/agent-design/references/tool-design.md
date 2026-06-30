# Tool Design & ACI

## The Agent-Computer Interface (ACI)

Tool definitions deserve the same attention as system prompts. The **Agent-Computer Interface** is as important as the Human-Computer Interface.

For each tool, the agent needs to know—from the definition alone, mid-inference:
- **When** to use this tool (vs other tools)
- **What** it does and what it doesn't do
- **What** to expect back (format, success/failure signals)
- **What** the boundaries are (scope, side effects, reversibility)

Parameter names and descriptions should be written for a model reading them during generation, not for a developer browsing an IDE.

### Practical Guidelines

- Write descriptions as if explaining to a capable but uninformed collaborator
- Include example usage, edge cases, and clear boundaries from similar tools
- Make it hard to call the tool incorrectly—adjust parameter design, not just descriptions
- Test how the model actually uses the tool; iterate on the interface, not just the prompt
- Prefer formats close to what the model has seen in training (natural text > exotic schemas)
- Avoid formats with "overhead" (e.g., requiring exact line counts, heavy JSON escaping)

> Concrete example from Anthropic's SWE-bench work: switching from relative to absolute file paths in a coding agent eliminated an entire class of errors—not from prompting, but from tool design alone.

---

## Interface Wrapping as Knowledge Displacement

When an agent is expected to use a raw tool but the designer lacks confidence in its judgment, the natural engineering instinct is to wrap that tool in a structured semantic interface:

```
// Instead of:
bash("claude -p 'implement user login in my-project'")

// Designer creates:
start_code_task(repo, goal, constraints)
continue_code_task(task_id, hint)
finalize_code_task(task_id)
```

This is a **knowledge displacement error**. The "how to use this" knowledge that belongs in a Skill gets baked into the interface instead, constraining the possibility space before the agent ever acts.

**Why this is wrong:**
- Strips the agent's ability to compose the tool with other tools in novel ways
- Encodes assumptions about usage that may not hold across contexts
- Every structured wrapper is a frozen decision about what the agent is allowed to want
- Reduces composability: the wrapped interface can only do what its designer anticipated

**The correct separation:**
- **Tools** are raw system boundaries—they expose primitive capabilities without encoding usage assumptions
- **Skills** are knowledge packages—they teach the agent *when* and *how* to wield those primitives

The instinct to wrap is a symptom of distrust in the agent's judgment. The correct response to that distrust is a better Skill, not a narrower interface.

---

## Environment as Ground Truth

An agent's sense of progress must come from actual tool call results—what the environment returned—not from internal prediction or belief about what *should have* happened.

Design agent loops around environmental feedback:
1. **Act** — call a tool
2. **Observe** — read the actual result
3. **Act again** — informed by what actually happened

An agent that maintains an internal "mental model" of the world and trusts it over tool outputs is building on sand. The environment is always authoritative. When a tool returns an unexpected result, that result is the ground truth—not the agent's prior expectation.

This principle also applies to multi-step tasks: don't assume step N succeeded because step N-1 succeeded. Verify from the environment.
