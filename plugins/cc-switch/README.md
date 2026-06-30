<p align="center">
  <img src="../../.github/Cradle.png" alt="Cradle Icon" width="128" />
  <img src="https://github.com/farion1231/cc-switch/blob/main/src-tauri/icons/icon.png?raw=true" alt="Nowledge Icon" width="136" />
  <h1 align="center"><b>CC-Switch for Cradle</b></h1>
  <p align="center">
    Official Cradle plugin for reading model providers from CC-Switch.
    <br />
    <br />
  </p>
</p>

This plugin registers a Cradle external provider source named `cc-switch`. It reads CC Switch provider data from the local CC Switch SQLite database and local settings JSON, then returns a fixed snapshot shape for the Cradle host to project into read-only provider profiles.

The plugin never writes to `~/.cc-switch`, never owns Cradle Provider UI, and never writes `agent_profiles` directly. The Cradle host owns projection, credential encryption, read-only guards, refresh routes, and the fixed Provider settings UI.

CC Switch is treated as a connection source. Snapshot records project base URLs and credentials into Cradle-owned encrypted secrets, including API keys and Codex ChatGPT auth tokens from CC Switch Codex auth JSON. Available model lists, custom models, visibility, models.dev mappings, and cost metadata stay owned by Cradle provider/profile modules.

External CC Switch data is parsed defensively. Nullable optional fields such as missing API keys are treated as absent values, and malformed provider rows are reported as source warnings instead of failing the whole refresh.

## Files

- `package.json`: Declares the Cradle plugin manifest and build scripts.
- `vite.config.ts`: Builds the server plugin entry for packaged desktop use.
- `tsconfig.json`: TypeScript configuration for the plugin source.
- `src/server.ts`: Activates the plugin and registers the external provider source.
- `src/cc-switch-source.ts`: Reads CC Switch SQLite/JSON data and maps supported providers to Cradle snapshot records without projecting CC Switch model lists into Cradle profile config.
- `src/cc-switch-source.test.ts`: Uses a temporary CC Switch-like database with fake secrets to verify mapping, current provider precedence, and redaction boundaries.

## Configuration

By default the plugin reads:

- `~/.cc-switch/cc-switch.db`
- `~/.cc-switch/settings.json`

The paths can be overridden with shared config keys or environment variables:

- `CC_SWITCH_APP_CONFIG_DIR` or `CRADLE_CC_SWITCH_APP_CONFIG_DIR`
- `CC_SWITCH_DB_PATH` or `CRADLE_CC_SWITCH_DB_PATH`
- `CC_SWITCH_SETTINGS_PATH` or `CRADLE_CC_SWITCH_SETTINGS_PATH`

## Supported Projection

The first version projects `claude`, `codex`, and OpenAI-compatible `gemini` providers. Codex providers with `auth.tokens.access_token` and a ChatGPT account ID are projected with a Cradle `chatgpt-auth` credential instead of a plain API key. Claude providers are projected only when their CC Switch API format is native Anthropic Messages (`anthropic`); routed formats such as `openai_chat`, `openai_responses`, and `gemini_native` are skipped because Cradle does not own CC Switch's routing converter. Other CC Switch app families are counted and reported as warnings, but they are not projected as runnable Cradle provider profiles yet.
