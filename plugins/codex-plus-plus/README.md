# Codex++ for Cradle

This plugin registers a Cradle external provider source named `codex-plus-plus`.

It reads Codex++ relay profiles from local settings, projects supported OpenAI-compatible profiles into Cradle provider targets, and imports the profile model list as initial custom models.

The plugin reads:

- `~/.codex-session-delete/settings.json`

The path can be overridden with shared config keys or environment variables:

- `CODEX_PLUS_PLUS_SETTINGS_PATH` or `CRADLE_CODEX_PLUS_PLUS_SETTINGS_PATH`

The plugin never writes to Codex++ configuration. Credentials from `authContents` are projected into Cradle-owned encrypted secrets instead of provider record metadata.
