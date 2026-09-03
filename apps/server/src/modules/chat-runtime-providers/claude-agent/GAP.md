# Claude Agent Runtime Gaps

This file classifies Claude Agent SDK capabilities that Cradle cannot project without changing ownership or a shared Chat Runtime contract. The SDK `Query`, command lifecycle, and result boundaries remain authoritative as defined by the [provider lifecycle contract](./README.md#iron-law--do-not-take-over-claude-lifecycle).

Protocol baseline: Claude Agent SDK **0.3.251**.

`Protocol only` means the SDK/wire exposes the fact but its public host callback or Cradle ownership boundary does not permit a truthful control.

| Native fact | Class | Boundary |
| --- | --- | --- |
| Assistant/result `user_message_uuid` | **Projected** | Assistant and result metadata preserve the exact correlation key; it is never used as queue completion or turn scheduling authority. |
| Permission `matchedAskRule` | **Projected** | Passed through approval metadata so the UI can distinguish a user-configured forced prompt without parsing prose. |
| Result `queued_turn_count` | **Projected** | Exposed as informational native queue depth in the usage state. `command_lifecycle` remains completion authority because queued sends may coalesce. |
| Per-model `costBasis` and canonical provider/model | **Projected** | The usage slot keeps SDK cumulative estimated cost and per-model cost rows, explicitly labeled estimates rather than billing truth. |
| `PreModelSwitch` / `PostModelSwitch` hooks | **Projected** | A warm-cache switch with nonzero estimated cache-write cost uses Cradle pending approval. Post-switch facts preserve from/to/source, cache warmth/TTL, context tokens, estimated cost, and pricing source. No invented cost threshold is used. |
| Permission `default_to_no` / `suppress_always_allow_rule` | Protocol only | The SDK wire schema contains these safety facts, but public `CanUseTool` callback types in 0.3.251 do not expose them. Cradle cannot safely infer them. |
| Per-server MCP timeout | **Projected** | Cradle-owned MCP registrations accept a positive timeout in seconds and forward it to each Claude SDK server config. |
| Managed pricing/cache metadata | **Projected** | Model usage and model-switch state explain whether estimates use managed/configured, catalog/list, default, or unknown pricing. |
