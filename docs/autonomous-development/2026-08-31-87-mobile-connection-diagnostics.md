# Show connection latency and uptime on iOS

- **Date:** 2026-08-31
- **Problem:** Settings reduced every successful health check to “Connected,” hiding whether the Mobile-to-Server round trip was responsive and whether the server had recently restarted.
- **Motivation:** Objective connection facts help users distinguish a live but slow network from a restarted server without turning Mobile into an operations console.
- **Product behavior:** The native iOS connection status row now includes the latest measured round-trip time in milliseconds. Its section footer shows server uptime in compact days/hours/minutes/seconds. Tapping the row reruns the existing health check and refreshes both values; unavailable and checking states keep their prior focused copy.
- **Implementation summary:** Timed the owned `/health` request with the runtime monotonic clock, retained the typed health payload for uptime, and passed both facts through the Settings View contract. The iOS View performs deterministic duration formatting without qualitative latency thresholds.
- **Files / systems affected:** Mobile health-query result, Settings contract, native iOS Settings presentation, and fixture.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Round-trip time includes local client and network overhead and represents one request, not a benchmark. Showing the exact value avoids overstating precision with a quality label.
- **Follow-up ideas:** Expose the last successful check time only if users need to reason about stale diagnostics.
- **Out of scope:** Historical charts, latency grading, memory/CPU telemetry, background probes, and non-iOS presentation.
