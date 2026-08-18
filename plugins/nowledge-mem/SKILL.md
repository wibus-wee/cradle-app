---
name: cradle-plugin-nowledge-mem
description: Use the Nowledge Mem MCP tools registered by Cradle for Working Memory, Context Bundle, durable memory recall, explicit memory writes, and conversation thread lookup or capture. Invoke as /cradle-plugin-nowledge-mem when a task needs prior Nowledge context or a durable memory update.
---

# Nowledge Mem

Use the `nowledge-mem` MCP tools exposed by the runtime. Do not call Cradle plugin HTTP routes for memory, context, or thread operations; those proxy routes do not exist.

## Recall

At the start of a task that benefits from personal or project context, read the Context Bundle when the MCP server exposes it. Use Working Memory as the lighter fallback. Search durable memories for facts, preferences, decisions, procedures, and learnings. Search threads when the original conversation or message provenance matters.

Prefer focused retrieval over loading broad history. When the server exposes Nowledge FS, search or recall first and read only the useful paths or line windows.

## Writes

Create or update a durable memory only when the user asks to save, preserve, or correct information, or when the active workflow explicitly requires a memory update. Search for an existing memory before creating a duplicate.

Capture or append a thread only when the user or workflow requests conversation preservation. A thread keeps conversational provenance; a memory stores the durable takeaway. Do not substitute a generated summary for a real transcript when the user asked to save the thread.

This plugin registers MCP tools but does not automatically inject recall, capture sessions, or save before compaction. Never claim those lifecycle behaviors occurred unless a separate runtime integration performed them.
