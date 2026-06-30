<!-- Once this directory changes, update this README.md -->

# Features/Composer Toolbar

Shared composer controls for selecting runtime, provider target, provider-owned model, and thinking effort across chat entry points. Runtime options come from the Chat Runtime catalog when available, with builtin fallbacks for offline/dev startup. Thinking effort supports model-filtered `low`, `medium`, `high`, and extended `xhigh` choices.

## Files

- **chat-agent-identity.tsx**: Read-only bound-agent identity chip for existing chat sessions, using the Agent Runtime avatar adapter.
- **agent-selector.tsx**: Agent list picker shown in the provider/model slot when the runtime selector is set to Agents.
- **cli-tui-agent-selector.tsx**: Legacy CLI TUI agent selector for terminal-backed runtime launches.
- **composer-profile-selection.ts**: Composer-owned provider visibility helpers; composer surfaces see enabled provider targets compatible with the selected runtime kind, using runtime catalog provider-kind metadata when provided.
- **composer-profile-selection.test.ts**: Regression coverage for hidden disabled providers and runtime/provider compatibility scoping.
- **composer-toolbar.tsx**: Root toolbar component that keeps runtime selection separate from the right-side target selector; the Runtime menu can switch the provider/model slot into an Agent list.
- **constants.ts**: Builtin runtime fallback and thinking effort label options.
- **index.ts**: Barrel exports for the toolbar feature.
- **provider-model-menu.tsx**: Reusable Provider > model > thinking cascading menu content plus the shared current-provider model list; model lists are keyed by provider target id, model search trims surrounding whitespace, and thinking options are filtered by the selected model.
- **provider-model-picker.tsx**: Unified trigger plus `ProviderModelMenu` composition reused by composer surfaces and Jarvis settings.
- **provider-model-selector.tsx**: Composer toolbar state adapter for `ProviderModelPicker`; direct model selection forwards the owning provider target id.
- **provider-model-selector.test.tsx**: Regression coverage for provider-owned model lists in the menu.
- **runtime-selector.tsx**: Runtime kind selector for draft chat composers, plus a read-only runtime chip for bound chat sessions; supports plugin runtime labels, descriptions, and icon keys from the runtime catalog.
- **types.ts**: Toolbar selection and model-map type definitions.
- **use-composer-state.ts**: Unified composer state hook that resolves runtime catalog options, provider targets, the active provider-or-agent target mode, cached model maps, selected model, bound chat agent identity, thinking effort, and persisted composer choices.
- **use-composer-state.test.tsx**: Regression coverage for persisted composer choices and direct model-to-profile selection.
