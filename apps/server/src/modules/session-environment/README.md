# Session Environment module

This module owns per-session notes, pinned transcript messages, and exact text-range markers. It also exposes one dense read model that composes read-only data from Usage, Pull Request, Automation, Turn Checkpoint, and Thread Handoff.

The aggregate endpoint never writes into those namespaces. Work remains the owner of objective, managed execution, and prepared delivery handoff; the web environment panel reads Work separately and presents it in the same aside.
