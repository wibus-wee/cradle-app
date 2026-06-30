<!-- Once this directory changes, update this README.md -->

# Features/Context

Renderer-owned context runtime contracts and provider lifecycle for Jarvis prompt grounding.
This directory owns the generic `ContextItem`, `ContextProvider`, `ContextEnvelope`, registry, provider slot replacement, and app-level provider installation helper.
Feature modules own the semantics of the items they publish; this runtime only composes those providers and captures their output into typed envelopes.

## Files

- **context-items.ts**: Typed semantic context item, reference, envelope, freshness, sensitivity, and token-estimation contracts shared by renderer context providers.
- **context-registry.ts**: Renderer context registry with one active provider slot per owner, generation-aware cleanup for remount/HMR safety, duplicate-owner validation for app-level provider lists, and envelope collection from the active route surface.
- **context-registry.test.ts**: Unit coverage for envelope collection, owner-slot replacement, stale-disposer behavior, provider-list duplicate validation, and list cleanup.
