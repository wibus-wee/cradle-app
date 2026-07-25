# `@cradle/model-api-simulator`

Deterministic loopback simulator for the core Anthropic Messages and OpenAI
Responses wire protocols. It is intended for tests that must exercise the real
official SDK scheduling, streaming, and accumulation logic without contacting
an upstream model API.

The simulator is wire- and behavior-compatible within its checked-in core
profile. It is not a model: every request must consume an explicitly enqueued
exchange, and an unexpected request fails with a provider-native error.

## Core profile

The package supports:

- Anthropic Messages create (JSON and SSE), token counting, and model
  list/retrieve.
- Anthropic text, ordinary `tool_use`, thinking, redacted thinking, ping,
  stream error, and disconnect flows.
- OpenAI Responses create (JSON and SSE), retrieve, cancel, delete, input
  items, input-token count, compact, and model list/retrieve.
- OpenAI text, refusal, reasoning, ordinary function call, lifecycle, error,
  and disconnect flows.

The sole allowlist is [`protocol/core-scope.json`](./protocol/core-scope.json).
MCP, web/file search, citations and annotations, image/audio generation,
computer use, shell, code interpreter/execution, custom tools, and
provider-hosted server tools are deliberately excluded. Other API families,
including Chat Completions, Realtime, Assistants, Anthropic batches, and cloud
provider dialects, are also outside this package.

## Quick start

```ts
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { startModelApiSimulator } from '@cradle/model-api-simulator'

const simulator = await startModelApiSimulator()

simulator.controller.enqueue({
  provider: 'anthropic',
  exchanges: [{
    label: 'hello',
    request: { method: 'POST', path: '/v1/messages' },
    response: {
      kind: 'json',
      body: {
        // Use a payload accepted by the checked-in Anthropic schema.
      },
    },
  }],
})

const anthropic = new Anthropic({
  apiKey: 'test-key',
  baseURL: simulator.anthropicBaseUrl,
  maxRetries: 0,
})

const openai = new OpenAI({
  apiKey: 'test-key',
  baseURL: simulator.openaiBaseUrl,
  maxRetries: 0,
})

try {
  // Call the official clients after enqueueing matching provider exchanges.
  void anthropic
  void openai
  simulator.controller.assertExhausted()
} finally {
  await simulator.close()
}
```

`anthropicBaseUrl` is the listener origin; `openaiBaseUrl` includes `/v1`, as
expected by the respective official clients. Instances bind only to
`127.0.0.1`, use an isolated random port by default, and never mutate process
environment variables.

## Scenarios and deterministic streaming

Scenarios contain ordered, provider-tagged exchanges. Request method, path,
optional body, and expected headers are matched before a response is selected.
All request bodies, JSON responses, and SSE events are validated against the
checked-in provider snapshot. Unsupported core variants fail before stream
bytes are written.

A streaming response uses explicit steps:

```ts
steps: [
  { kind: 'event', event: firstEvent },
  { kind: 'gate', name: 'continue' },
  { kind: 'event', event: secondEvent },
  { kind: 'close' },
]
```

Use `await controller.waitForRequest(...)` to observe the SDK request, then
`controller.release('continue')` to advance it. A `yield` gives the scheduler
one turn but does not promise a separate TCP chunk; use a named gate whenever
the test needs an externally observable pause.

`controller.requests()` returns the deterministic request ledger.
`controller.assertExhausted()` checks that exchanges, gates, and streams were
fully consumed. `reset()` is allowed only with no open stream. `close()` is
idempotent and cancels open streams before closing the listener.

## Protocol artifacts

Provider snapshots and compatibility manifests live under `protocol/`.
OpenAI's manifest pins the official OpenAPI commit and source, normalized, and
core-scope hashes. Anthropic's manifest pins the official SDK version,
declaration hashes, generated schema, core-scope, and handwritten stream
grammar hashes.

```sh
# Networked: deliberately refresh the pinned OpenAI source.
pnpm protocol:refresh:openai --ref <exact-openapi-commit>

# Local SDK declarations only.
pnpm protocol:refresh:anthropic

# Offline generation and CI checks.
pnpm protocol:generate
pnpm protocol:check
pnpm coverage:check
```

`protocol:check` regenerates into a temporary directory and byte-compares the
result without rewriting the package. `coverage:check` revalidates every
checked-in positive witness and rejected near-neighbor with AJV, and fails if a
core schema root or registered transition is uncovered.

Treat snapshot refreshes as protocol changes. Review the manifests, core
allowlist, generated witness corpus, and grammar coverage together. A newly
published provider event is not automatically part of the core profile.

## Limitations

- No model intelligence or prompt matching.
- No fallback for an unmatched request.
- No recording, proxying, fixture redaction, or replay of upstream traffic.
- Logical SSE events are ordered, but transports may coalesce adjacent writes.
