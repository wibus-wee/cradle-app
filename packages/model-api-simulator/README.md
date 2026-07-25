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

## Anthropic SDK quick start

```ts
import Anthropic from '@anthropic-ai/sdk'
import { startModelApiSimulator } from '@cradle/model-api-simulator'

const simulator = await startModelApiSimulator()
try {
  simulator.controller.enqueue({
    provider: 'anthropic',
    exchanges: [
      {
        label: 'anthropic greeting',
        request: {
          method: 'POST',
          path: '/v1/messages',
          bodyFields: {
            '/model': 'claude-test',
            '/messages/0/content': 'hello',
          },
        },
        response: {
          kind: 'json',
          body: {
            id: 'msg_simulator',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content: [{ type: 'text', text: 'hello back', citations: null }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            container: null,
            stop_details: null,
            usage: {
              cache_creation: null,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              inference_geo: null,
              input_tokens: 1,
              output_tokens: 2,
              output_tokens_details: null,
              server_tool_use: null,
              service_tier: null,
            },
          },
        },
      },
    ],
  })

  const anthropic = new Anthropic({
    apiKey: 'test-key',
    baseURL: simulator.anthropicBaseUrl,
    maxRetries: 0,
  })

  const message = await anthropic.messages.create({
    model: 'claude-test',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'hello' }],
  })
  if (message.content[0]?.type !== 'text' || message.content[0].text !== 'hello back') {
    throw new Error('unexpected Anthropic response')
  }
  simulator.controller.assertExhausted()
} finally {
  await simulator.close()
}
```

## OpenAI SDK quick start

```ts
import OpenAI from 'openai'
import { startModelApiSimulator } from '@cradle/model-api-simulator'

const simulator = await startModelApiSimulator()
try {
  const response = {
    id: 'resp_simulator',
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model: 'gpt-test',
    output: [
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: 'hello back',
            annotations: [],
            logprobs: [],
          },
        ],
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: null,
    service_tier: 'default',
    store: false,
    temperature: 1,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    truncation: 'disabled',
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 3,
    },
    metadata: {},
  } as const

  simulator.controller.enqueue({
    provider: 'openai',
    exchanges: [
      {
        label: 'OpenAI greeting',
        request: {
          method: 'POST',
          path: '/v1/responses',
          bodyFields: {
            '/model': 'gpt-test',
            '/input': 'hello',
          },
        },
        response: { kind: 'json', body: response },
      },
    ],
  })

  const openai = new OpenAI({
    apiKey: 'test-key',
    baseURL: simulator.openaiBaseUrl,
    maxRetries: 0,
  })

  const result = await openai.responses.create({
    model: 'gpt-test',
    input: 'hello',
  })
  if (result.output_text !== 'hello back') {
    throw new Error('unexpected OpenAI response')
  }
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

Use `await controller.waitForRequest(...)` to observe the SDK request. For a
race-free pause, wait until the stream owns the gate before releasing it:

```ts
await controller.waitForRequest({ method: 'POST', path: '/v1/responses' })
await controller.waitForGate('continue')
controller.release('continue')
```

A `yield` gives the scheduler one turn but does not promise a separate TCP
chunk; use a named gate whenever the test needs an externally observable pause.

`controller.requests()` returns the deterministic request ledger.
`controller.assertExhausted()` checks that exchanges, gates, and streams were
fully consumed. `reset()` is allowed only with no open stream and clears the
scenario state, request ledger, gates, and stored OpenAI response resources.
`close()` is idempotent, clears instance state, and cancels open streams before
closing the listener.

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

Generated witnesses and coverage payloads live in the ignored
`.cache/protocol-artifacts/<input-fingerprint>/` directory, not in Git. The
first `protocol:check` or `coverage:check` on a machine generates the cache;
later checks reuse it while the package sources, protocol inputs, dependencies,
and corpus-validator versions remain unchanged.

`protocol:generate` intentionally refreshes both the local cache and the small
checked-in `protocol/generated-artifacts.json` hash manifest. `protocol:check`
verifies the input fingerprint and cached output hashes against that manifest.
`coverage:check` revalidates every generated positive witness and rejected
near-neighbor with AJV, and fails if a core schema root or registered transition
is uncovered.

Treat snapshot refreshes as protocol changes. Review the manifests, core
allowlist, generated witness corpus, and grammar coverage together. A newly
published provider event is not automatically part of the core profile.

## Limitations

- No model intelligence or prompt matching.
- No fallback for an unmatched request.
- No recording, proxying, fixture redaction, or replay of upstream traffic.
- Logical SSE events are ordered, but transports may coalesce adjacent writes.
