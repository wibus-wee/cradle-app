# Cradle Observability Stack

This directory owns the local Prometheus and Grafana stack used to inspect Cradle server telemetry.

## Start

From the repository root:

```sh
pnpm observability:up
```

Open Grafana at http://localhost:3001. Login is disabled for local development.

Prometheus is available at http://localhost:9090.

## Start Cradle with Metrics

Run Cradle with the Prometheus exporter enabled:

```sh
CRADLE_OTEL_ENABLED=1 \
CRADLE_OTEL_METRICS_ENABLED=1 \
CRADLE_OTEL_PROMETHEUS_ENABLED=1 \
CRADLE_OTEL_PROMETHEUS_HOST=127.0.0.1 \
CRADLE_OTEL_PROMETHEUS_PORT=9464 \
pnpm dev:desktop
```

The Docker Prometheus container scrapes `host.docker.internal:9464/metrics`, which maps back to the Cradle server exporter on the host.

## Dashboards

- `Cradle Runtime - Resources` (`/d/cradle-runtime`) covers Cradle-owned runtime metrics: server process, chat runtime, provider runtime, PTY, Chronicle, observability queue, desktop samples, and renderer diagnostics.
- `Cradle Runtime - Correlations` (`/d/cradle-correlations`) overlays renderer, desktop, chat stream, provider, queue, and server pressure signals for leak and retention analysis. See [runtime-correlations.zh-CN.md](./runtime-correlations.zh-CN.md).
- `Cradle Server - Runtime & HTTP` (`/d/cradle-server`) covers generic HTTP, Node.js runtime, V8, process, and host metrics from OpenTelemetry instrumentation.

## Stop

```sh
pnpm observability:down
```
