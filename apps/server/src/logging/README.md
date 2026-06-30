# Logging

Shared server logging infrastructure. Startup, plugin host, request, and fatal process diagnostics should go through this namespace so stdout and file logging stay consistent.

## Files

- **logger.ts**: pino-backed logger wrapper. Stdout uses NestJS-style pretty-print with picocolors (human-readable in TUI); file destination writes raw JSON. Supports child logger creation and explicit flush for fatal exits.
