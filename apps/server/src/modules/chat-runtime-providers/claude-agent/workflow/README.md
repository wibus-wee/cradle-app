# Claude Workflow observation

This directory owns Claude Agent Workflow semantics from tool execution metadata through the live UI snapshot. It is separate from generic provider-thread/SubAgent projection because a Workflow is one orchestrated run containing phases and many agents, not one child thread.

- `execution.ts` projects Workflow tool input, output, and lifecycle records.
- `declaration-instrumenter.ts` instruments JavaScript control flow with stable discovery decisions.
- `declaration-extractor.ts` executes the instrumented script with inert Workflow functions in a resource-limited Worker and reports incomplete exploration explicitly.
- `event-parser.ts` normalizes live journal/transcript JSONL and final Workflow JSON.
- `state-reducer.ts` folds declared, inferred, and authoritative observations into the SSE snapshot.
- `artifact-stream.ts` owns JSONL tails, final-artifact watching, publication, and cleanup after the final subscriber leaves.

Final `workflow_phase` and `workflow_agent` records are authoritative. Live prompt matching is accepted only when one exact prompt identifies one unmatched declaration; declaration discovery is never presented as a Runner fact.
