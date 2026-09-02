<!-- Once this directory changes, update this README.md -->

# Codex Reset Watch

This module owns Cradle's read-only projection of the public Codex Resets watch. It registers an hourly Maintenance task, uses the shared outbound-network boundary and conditional ETag requests, and publishes an expiring Background Activity footer presentation only while a watch remains active. The versioned status API owns the watch lifecycle, forecast percentage, source, and expiry. Cradle renders the expiry in the server's local time zone and does not depend on the website's private community-vote endpoint.

The percentage is an AI-classified forecast rather than an OpenAI commitment. A newer reset announcement or the watch expiry clears the presentation. Refresh failures leave the previous unexpired presentation intact through Background Activity semantics. The module does not read Codex credentials, consume reset credits, or replace provider-owned account usage diagnostics.

## Files

- **service.ts**: response validation, ETag caching, footer projection, and Maintenance registration.
- **service.test.ts**: active, reset-completed, and expired watch projections.
