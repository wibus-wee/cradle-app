# Claude Workflow observation

This directory owns Claude Agent Workflow semantics from tool execution metadata through the live UI snapshot. It is separate from generic provider-thread/SubAgent projection because a Workflow is one orchestrated run containing phases and many agents, not one child thread.

- `execution.ts` projects Workflow tool input, output, and lifecycle records.
- `declaration-instrumenter.ts` instruments JavaScript control flow with stable discovery decisions.
- `declaration-extractor.ts` executes the instrumented script with inert Workflow functions in a resource-limited Worker and reports incomplete exploration explicitly.
- `event-parser.ts` normalizes live journal/transcript JSONL and final Workflow JSON.
- `state-reducer.ts` folds declared, inferred, and authoritative observations into the SSE snapshot.
- `artifact-stream.ts` owns JSONL tails, final-artifact watching, publication, and cleanup after the final subscriber leaves.

Final `workflow_phase` and `workflow_agent` records are authoritative. Live prompt matching is accepted only when one exact prompt identifies one unmatched declaration; declaration discovery is never presented as a Runner fact.

## Declaration extraction rationale

Workflow authoring currently expresses phases and agents through executable JavaScript rather than a separate static manifest. The declaration extractor therefore instruments the script's control-flow decisions and executes the result with inert Workflow functions. This preserves the existing authoring model while exploring the finite declaration paths that the same script can expose. Requiring a static declaration format would be simpler to inspect, but it would change workflow authoring and every consumer of `ClaudeWorkflowDeclaration`; that redesign is outside this module's current contract. Parsing without execution also cannot faithfully resolve ordinary JavaScript control flow, computed values, or helper calls into the declarations the runtime sees.

This remains a heuristic with an explicit threat model: agent-supplied code executes in a worker thread that shares the server process's memory and privileges. Worker threads are resource-containment tools, not a security boundary. The extractor limits scripts to 512 KiB, explores at most 256 paths, stops after 3 seconds, and starts workers with 64 MiB old-generation and 16 MiB young-generation heaps plus a 4 MiB stack. Abort and termination tear down incomplete work, and the result exposes `incomplete` instead of claiming exhaustive discovery. These caps bound common CPU and memory abuse, but they do not make hostile code safe. Replacing executable declarations with a static format is the sound route to a stronger trust boundary; until that larger workflow contract change is undertaken, the instrumented worker is retained because it is the only approach that preserves current workflow semantics and consumers.
