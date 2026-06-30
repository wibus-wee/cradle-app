---
name: nowledge-mem
description: Use Cradle's official Nowledge Mem plugin for guided Working Memory, Context Bundle, memory search, explicit memory writes, and thread lookup or append. Use when the task needs prior Nowledge memories, saved conversation context, or a durable memory distillation through Cradle plugin routes.
---

# Nowledge Mem

Use this skill when a task needs Nowledge Mem context through Cradle. This M0 plugin provides guided operations through plugin routes. It does not provide automatic pre-turn recall, automatic session capture, or pre-compaction capture yet.

## Available Cradle Plugin Routes

The plugin is mounted under `/api/plugins/nowledge-mem`.

- `GET /status` checks plugin configuration and Nowledge reachability.
- `GET /working-memory` reads Nowledge Working Memory.
- `GET /context-bundle` reads a Context Bundle with `source_app=cradle`.
- `GET /memories/search?q=<query>&limit=5` searches Nowledge memories. Memory search uses `q`, not `query`.
- `POST /memories` explicitly creates a Nowledge memory.
- `GET /threads/search?query=<query>&limit=5` searches Nowledge threads. Thread search uses `query`, not `q`.
- `GET /threads/:threadId?limit=30&offset=0` reads a Nowledge thread.
- `POST /threads` explicitly creates a Nowledge thread.
- `POST /threads/:threadId/append` explicitly appends messages to a Nowledge thread.

## Usage Guidance

Start with `GET /status` if the user is asking about setup, connection, endpoint, or credentials. Use `GET /working-memory` for a daily briefing or current memory state. Use memory search for durable facts, preferences, decisions, procedures, and learnings. Use thread search when the user asks about a prior conversation or needs full conversational provenance.

Write memory only when the user asks you to save, distill, or preserve durable information, or when the task explicitly calls for updating Nowledge. Do not pretend that M0 automatically captures the current Cradle chat. Until lifecycle support lands, thread creation and append are explicit operations.

Nowledge owns memories, threads, spaces, and graph data. Cradle owns only this plugin adapter and its non-secret configuration.
