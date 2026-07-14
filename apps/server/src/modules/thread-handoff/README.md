# Thread Handoff module

Thread Handoff owns explicit provider-to-provider transfer semantics and provenance. It validates that the source is idle, creates a destination Session on another compatible enabled provider target, imports completed top-level user and assistant messages through Chat Runtime's `MessageImported` event path, and compensates by deleting the destination if bootstrap import fails.

Session continues to own destination metadata. Chat Runtime continues to own transcript events. Provider Targets continues to own availability and runtime compatibility. This module stores only the `ThreadHandoff` relationship and imported-message count.
