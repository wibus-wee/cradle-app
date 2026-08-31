# Show live server health on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile Settings showed saved connection details but did not distinguish a configured server from a currently reachable server.
- **Motivation:** Remote users need fast confidence that failures come from connectivity before changing credentials or server settings.
- **Product behavior:** Settings now reports checking, connected, or unavailable server health and offers a manual retry whenever a check is complete.
- **Implementation:** `SettingsContainer` owns a focus-aware `/health` query and passes a typed status into the fixture-renderable `SettingsView`.
- **Systems affected:** Mobile Settings and its fixture.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The status reflects the latest foreground check rather than continuously monitoring the server.
- **Follow-up ideas:** Surface latency if real-world dogfooding shows that reachable-but-slow connections need diagnosis.
- **Out of scope:** Background monitoring, notifications, and server configuration changes.
