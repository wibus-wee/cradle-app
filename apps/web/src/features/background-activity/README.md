<!-- Once this directory changes, update this README.md -->

# Features/Background Activity

User-facing projections of Server-owned Background Activity. Most activities remain developer-only; this feature renders only optional `presentation.footer` results.

The footer shows one compact summary at a time, ordered by activity priority and recency. Clicking it reveals a footer-anchored ambient activity layer with a translucent, backdrop-blurred chrome surface and no repeated header; active notices and source actions render directly as a compact stream. Known owners use the app's existing provider icon system (`codex-reset-watch` uses the Codex mark), while unknown owners fall back to the generic activity icon. The layer stays in the local layout rather than rendering through a global Popover portal. Clicking outside or pressing Escape closes only the layer. Notices remain visible while their owner continues publishing them; they disappear only when the owner clears them or their expiry is reached.

## Files

- **background-activity-footer.tsx**: Query and external-action container mounted by App Footer.
- **background-activity-footer-view.tsx**: Fixture-driven compact summary and ambient multi-notice activity layer.
- **background-activity-footer-state.ts**: Stable identity, expiry filtering, priority ordering, and view-model projection.
- **background-activity-footer-view.stories.tsx**: Multi-notice footer fixture.
- **background-activity-footer-view.test.tsx**: Collapsed-footer, persistent notice, and source-action interactions.
- **background-activity-footer-state.test.ts**: Ordering and expiry behavior.
