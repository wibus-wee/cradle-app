# Codex Runtime Gaps

This file records native Codex app-server capabilities that Cradle either has not projected yet or intentionally leaves provider-native. Prefer documenting here over advertising unsupported behavior.

Protocol baseline for this note: Codex CLI / app-server **0.146.0** (PR #106 protocol refresh), on top of the earlier 0.145 adaptations from PR #98.

## Classification key

- **Projected** — Cradle owns a Chat Runtime seam and UI/path for this fact.
- **Follow up** — Sound Cradle owner exists or can be designed; not shipped yet.
- **Leave native** — No sound Cradle contract, or ownership would collide with Cradle namespaces.

## PR #106 deltas

| Native fact | Class | Notes |
|---|---|---|
| `Thread.isPinned` + list/filter + metadata patch | Follow up | Cradle sidebar pins *workspaces*, not Codex threads. Do not invent a second pin store without an ownership decision. |
| `SkillInterface.iconSmallUrl` / `iconLargeUrl` | **Projected** | Skills UI slot `items[]` carries `iconUrl` / `brandColor` / `displayName`. |
| `commandExecution.pluginId` / `scriptPath` | **Projected** | Tool input args include plugin provenance for command executions. |
| `BrowserUseRequirements.disableAutoReview` | Follow up | Cradle already owns Browser Use bridge policy; avoid dual auto-review owners. |
| `FeedbackRequirements.enabled` + `feedback/upload` | Leave native | Cradle has no feedback submission UI or explicit log-consent flow, so it does not expose `/feedback`. |
| `externalAgentConfig/import/recordHistory` + detect limits | Leave native / Follow up | Only worth projecting if Cradle owns a Codex import UX. |
| `codexResponseHandoffChannelPrefixes` | Leave native | No Cradle realtime/voice product owner yet. |
| `AppToolSummary.isEnabled` / `disabledReason` / `isReadOnly` | Follow up | Needs `app/read` depth beyond current `app/list` counts. |
| `PlanType: ent26` | **Projected** | Known plan-type set includes `ent26`; account/usage continue to pass plan strings through. |
| `plugin/list.forceRefetch` | Follow up | Needs an explicit plugin-catalog refresh action. |

## Large unused protocol surface (historical)

Capability scan (~140 client methods; ~half unused outside generated protocol):

### Follow up (product-visible / half-wired)

1. **Apps / connectors depth** — `app/read`, `app/installed`, `InstalledApp`, `ConnectorMetadata`. Today only `app/list` feeds plugin-slot counts.
2. **Thread archive / unarchive / metadata** — listing filters exist; provider-thread UI does not project them.
3. **Environment connection** — `environment/*` + `thread/environment/*` notifications; overlaps Cradle remote hosts.
4. **Guardian approve denied action** — approval-path extension.
5. **fuzzyFileSearch session streaming** — richer than one-shot search.
6. **Plugin scheduled tasks** — types on `PluginDetail.scheduledTasks`; no Cradle automation owner.

### Leave native (or needs major design)

7. **Realtime voice** — full `thread/realtime/*` duplex + SDP/audio notifications. Needs audio/WebRTC owner; do not bolt onto `ChatRuntimeChunk`.
8. **Remote Control** — pairing/clients; security-sensitive; keep Codex-native.
9. **Plugin share** save/checkout/delete — Codex marketplace social graph; Cradle has its own plugin marketplace.
10. **fs write / remove / copy** via app-server — bypasses Cradle workspace audit.
11. **memory/reset / memoryMode** — Codex memory namespace.
12. **process/spawn PTY fine controls** — overlaps Cradle PTY module.

### Already projected (do not re-open without cause)

- Sleep items, rawResponse usage + cache-write, goals, compact, approvals/elicitation, background terminals list/terminate, collaboration modes, skills/plugin counts, shell / steer / interrupt, provider-thread fork.

## IRON LAW note

Codex adaptations here must remain **projections** of app-server facts. Do not introduce Cradle turn/session scheduling that reinterprets Codex turn boundaries.
