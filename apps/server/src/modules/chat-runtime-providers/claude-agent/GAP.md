# Claude Agent Runtime Gaps

This file classifies Claude Agent SDK capabilities that Cradle cannot project without changing ownership or a shared Chat Runtime contract. The SDK `Query`, command lifecycle, and result boundaries remain authoritative as defined by the [provider lifecycle contract](./README.md#iron-law--do-not-take-over-claude-lifecycle).

Protocol baseline: Claude Agent SDK **0.3.251**.

| Native fact | Class | Boundary |
| --- | --- | --- |
| Assistant/result `user_message_uuid` | **Projected** | Stored as message correlation metadata; never used as queue completion or turn scheduling authority. |
| Permission `matchedAskRule` | **Projected** | Passed through approval metadata so the UI can distinguish a user-configured forced prompt without parsing prose. |
| Result `queued_turn_count` | Leave native | Informational queue depth cannot replace `command_lifecycle`, and queued sends may coalesce into fewer turns. |
| Per-model `costBasis` | Follow up | Runtime usage events own token counters but have no provider-estimated cost or pricing-basis fields. |
| `PreModelSwitch` / `PostModelSwitch` hooks | Follow up | Live model changes already use SDK `setModel`; exposing hook interaction requires a complete shared settings/approval owner. |
| Permission `default_to_no` / `suppress_always_allow_rule` | Follow up | The SDK wire schema contains these safety facts, but the public `CanUseTool` options in 0.3.251 do not expose them to the host callback. |
| Per-server MCP timeout | Follow up | Cradle forwards MCP configuration, but Chat Runtime has no per-provider-server timeout setting or validation UI. |
| Managed pricing/cache metadata | Leave native | These are provider account and pricing-policy facts until usage contracts can represent estimates without treating them as billing truth. |
