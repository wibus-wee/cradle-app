---
name: multi-work
description: Multi-agent collaboration patterns. Use when a task benefits from multiple independent agents working in parallel (DAG) or serial adversarial refinement (Critique-Chain).
metadata:
  author: wibus
---

# Multi-Work

## Strategy Selection

- Task decomposes into independent parallel units → **DAG** (Strategy 1)
- Same conclusion needs multi-perspective challenge → **Critique-Chain** (Strategy 2)
- Strategies can be nested: any node in either strategy can spawn its own sub-strategy.

## Handoff File Convention (applies to both strategies)

All sub-agent outputs must be written to `docs/multi-work/{topic}/{YYYYMMDD}-{short-description}-{Agent-type}{id}.md`.

- **Location**: `docs/multi-work/{topic}/`
- **Naming**: `{YYYYMMDD}-{short-description}-{Agent-type}{A/B/C/...}.md` (e.g. `docs/multi-work/auth-refactor/20260517-initial-proposal-ExplorationA.md`)
- **Format**: Markdown, self-contained — the file alone must be intelligible to a reader who has no other context.
- **Audience**: write every handoff file as if it will be reviewed by the highest authority (Linus). Be thorough, be honest about uncertainty, and do not bury tradeoffs.

Main Agent passes only the file reference to the next agent. Never paraphrase or summarize handoff content — the next agent reads the file directly.

### Quality Gate (self-check before handoff)

Each agent must verify before writing the handoff file:

- [ ] File is self-contained — intelligible with zero external context
- [ ] Tradeoffs and uncertainties are explicit, not buried
- [ ] Acceptance criteria from the spawn prompt are addressed
- [ ] No implementation details leaked from outside the assigned scope
- [ ] Written for human review — honest, thorough, no marketing language

## Strategy 1: DAG

Prerequisite: activate `exec-plan` skill first. If unavailable, abort and report to user — do not proceed without it.

- **Plan Files** must follow the `exec-plan` skill format. Please do not store Plan Files in the handoff directory. They should be stored in a separate directory, `exec-plan` skill has its own convention for Plan File naming and storage. 
- **Agent outputs** (findings, implementations, reviews, fixes) must follow the [Handoff File Convention](#handoff-file-convention-applies-to-both-strategies) above.

**PLAN FILES IS NOT HANDOFF FILE. DO NOT MIX THEM.**

## Workflow

```
Main Agent
  │
  ├─ Decompose task into independent units (DAG)
  │
  ├─ Parallel execution when dependencies allow
  │
  ├─ Merge results
  │
  ├─ Final integration review
  │
  └─ report
```

Per-node loop:

```
Main Agent
  ├─ spawn Exploration Agents to research and plan the assigned task node
  │    input: What user wants
  ├─ collect and synthesize findings into Plan File
  │    output: Plan Files
  │
  ├─ spawn Implementation Agents (Worker A, Worker B, Worker C,...)
  │    input: Plan Files + related files + assigned task
  │
  ├─ spawn Review Agents
  │    input: Plan Files + related files (let sub agent use git diff to discover changes)
  │
  ├─ Note: You can spawn any type of agent anytime, the above are just examples of typical node types. In practice, you can flexibly adjust and combine different types of sub-agents as needed to accomplish the task. By leveraging the independent context and parallel execution capabilities of sub-agents, you can greatly improve the efficiency and quality of handling complex tasks.
  │    
  │
  ├─ if review fails:
  │    spawn Fix Agent
  │      input: Plan File + related files + review output
  │      output: fixed artifact + fix summary
  │
  ├─ optional re-review after fix
  │
  └─ continue to merge when all nodes pass
```

## Rules

1. Main Agent owns Plan File, Workflow, merge, and report.
2. Sub agents start with empty context.
3. Spawn prompt should be thin:
   - role
   - assigned task node
   - Plan File reference
   - related file references
4. Do not teach sub agents how to solve the task.
   Do not prescribe implementation strategy unless required.
   Do provide objective acceptance criteria, constraints, and output contract.
5. Sub agents must read Plan File and related files themselves.
6. Parallelize nodes with no dependency edge.
7. Review each completed node independently.
8. Fix only failed review results.
   If still failing, escalate to Main Agent with unresolved issues.
9. If a failed review reveals an architectural issue, Fix Agent must not patch around it. It must return an Architecture Escalation Report to Main Agent.
10. Main Agent owns all architecture-level changes.
11. Only Main Agent report to user.

## Strategy 2: Critique-Chain

Adversarial refinement through independent perspectives. Each node hands off a file directly to the next node — Main Agent only passes the reference, never relays content.

```
Main Agent
  │
  ├─ spawn Agent(s) to produce initial conclusion
  │    output: handoff file A
  │
  ├─ spawn Agent(s) to critique
  │    input: handoff file A (direct reference, not relayed)
  │    output: handoff file B
  │
  ├─ spawn Agent(s) to synthesize
  │    input: handoff files A + B (direct references)
  │    output: handoff file C
  │
  ├─ (optional) spawn Agent(s) to critique synthesis
  │    input: handoff file C (direct reference)
  │    output: handoff file D
  │
  └─ Main Agent: merge handoff files and report
```

### Rules

1. Each node writes a handoff file. Next node reads it directly by reference — Main Agent never paraphrases between nodes.
2. Any node can spawn multiple agents in parallel to produce or critique independently.
3. Critique agents focus on what's missing, wrong, or could be better. They do not implement fixes.
4. Synthesis agent must reconcile conflicts, not just concatenate.
5. Main Agent decides chain length, parallelism per node, and node roles per task.
6. Stop when another round adds marginal value.

## Integration Quality Gate (Main Agent before report)

Main Agent verifies the full pipeline before reporting to user:

- [ ] All handoff files exist and follow naming convention
- [ ] No information loss across handoffs — each node's output is faithfully carried forward
- [ ] DAG merge resolves all cross-node conflicts; Critique-Chain synthesis addresses all critiques
- [ ] Architecture escalations (if any) are resolved, not patched around
- [ ] Final output is self-contained and ready for human review
- [ ] Failed reviews are re-fixed and re-reviewed — no open review debt
