# Server Telemetry

This directory owns Cradle Server OpenTelemetry bootstrapping. Product observability semantics still live in `apps/server/src/modules/observability`; this layer only configures standard traces, metrics, instrumentation, exporters, and small helpers for feature modules.

`CRADLE_OTEL_ENABLED=1` enables the runtime. OTLP traces and metrics are exported when `CRADLE_OTEL_EXPORTER_OTLP_ENDPOINT`, `CRADLE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, or `CRADLE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is set. Langfuse is an optional span processor controlled by `CRADLE_LANGFUSE_ENABLED=1` plus `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`; it is not the global telemetry switch.

Auto instrumentation should be initialized before most server modules are imported. `apps/server/src/index.ts` initializes telemetry before dynamically importing the app and feature modules. If future startup code imports HTTP clients, pino loggers, or provider SDKs before telemetry starts, those modules may not be patched for automatic spans.
