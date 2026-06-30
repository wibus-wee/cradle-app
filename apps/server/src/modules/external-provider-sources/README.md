# External Provider Sources

This module owns host-side persistence of plugin-provided provider source snapshots and external provider targets.

- `index.ts`: HTTP routes for listing sources, refreshing sources, listing source records, and reading external provider target metadata.
- `local-agent-config-source.ts`: Onboarding utility that reads allowlisted local Claude/Codex config files and scans Gemini, Pi, and Kimi CLI commands into an `ExternalProviderSourceSnapshot`; it is intentionally not registered on startup yet.
- `model.ts`: Elysia response schemas for the fixed external provider source API.
- `service.ts`: Snapshot validation, source persistence, registered-plus-persisted source listing, direct onboarding source refresh, `provider_targets(kind = 'external')` projection, secret upsert, missing-record handling, runtime preference preservation, disabled-target agent shutdown, and view serialization.

Plugins do not render Provider UI and do not write Cradle provider-target tables directly. They register external provider sources through `@cradle/plugin-sdk/server`; this module reads the registered sources and writes Cradle-owned external-source state plus external provider targets. Manual provider targets remain user-authored entries in `provider_targets`; external provider targets are `provider_targets` rows linked by source metadata, while external records stay in external-source-owned tables. Source refreshes replace source-owned config fields while preserving Cradle-owned runtime preferences such as model visibility, non-empty custom models, and `claudeAgent.modelAliases` provider defaults. Empty external-target custom models are bootstrapped from Cradle-owned endpoint templates or the source record's default model so imported providers are selectable before upstream model listing succeeds.
Source listing includes persisted source snapshots even when the plugin/source is not currently registered, so Settings can still group and inspect external records that already projected runtime targets.
External source credentials are persisted only through Cradle's encrypted secrets namespace. Supported credential kinds are `api-key` and `chatgpt-auth`; plugins provide the source snapshot, while this module owns the stable secret ref and encryption lifecycle.
When an external provider target is disabled explicitly or marked disabled because its source record disappeared, this module also disables agents bound to that provider target so launchability stays consistent with provider availability.
