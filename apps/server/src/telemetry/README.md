# Server Telemetry

This directory owns Cradle Server OpenTelemetry bootstrapping. Product observability semantics still live in `apps/server/src/modules/observability`; this layer only configures standard traces, metrics, instrumentation, exporters, and small helpers for feature modules.

`CRADLE_OTEL_ENABLED=1` enables the runtime. OTLP traces and metrics are exported when `CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT`, `CRADLE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, or `CRADLE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is set. Langfuse is an optional span processor controlled by `CRADLE_LANGFUSE_ENABLED=1` plus `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`; it is not the global telemetry switch.

PostHog AI Observability is an independent, AI-only OTLP exporter controlled by `CRADLE_POSTHOG_AI_OBSERVABILITY_ENABLED=1`, `CRADLE_POSTHOG_PROJECT_TOKEN`, and optional `CRADLE_POSTHOG_HOST`. It exports only spans explicitly marked by Cradle's AI observation boundary; generic HTTP, database, runtime, Langfuse, and auto-instrumentation spans are not forwarded to PostHog.

`CRADLE_POSTHOG_AI_CAPTURE_MODE=metadata` records provider/runtime, model, input/output/cache/reasoning token counts, cost, latency, time-to-first-token, outcome, and stop reason without conversation content. `CRADLE_POSTHOG_AI_CAPTURE_MODE=full` additionally records the bounded system prompt, conversation messages, assistant output, and tool names/inputs/outputs. Full capture is intentionally useful for internal debugging and model analysis, and must be treated as sensitive product data.

AI spans use schema version 2 and a versioned correlation contract. Every exported generation carries opaque `session_id` and `run_id` attributes plus `cradle.ai.correlation_version`. These values are deterministic hashes of Cradle-owned identifiers: raw session and run IDs are never exported. The hierarchy is `session_id` (logical chat session) → `run_id` (one assistant turn) → `$ai_span_id` (one model generation); `$ai_trace_id` identifies the technical OpenTelemetry trace. Keep these concepts separate when querying PostHog.

This exporter is internal/dev opt-in until a separate explicit AI-content consent state is synchronized with the server. Product analytics opt-out and AI-content capture are separate controls; do not enable `full` by default in end-user builds.

Auto instrumentation should be initialized before most server modules are imported. `apps/server/src/index.ts` initializes telemetry before dynamically importing the app and feature modules. If future startup code imports HTTP clients, pino loggers, or provider SDKs before telemetry starts, those modules may not be patched for automatic spans.
