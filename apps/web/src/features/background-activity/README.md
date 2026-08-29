<!-- Once this directory changes, update this README.md -->

# Features/Background Activity

User-facing projections of Server-owned Background Activity. Most activities remain developer-only; this feature renders only optional `presentation.footer` results.

The footer shows one compact summary at a time, ordered by activity priority and recency. Clicking it opens the complete pending list. Acknowledgement happens inside the popover, never directly in the footer: `OK` dismisses one stable notice identity and reveals the next, while `Dismiss all` acknowledges the currently visible set. Dismissals are renderer-local and persisted with a bounded history. Expired and acknowledged notices are filtered before rendering.

## Files

- **background-activity-footer.tsx**: Query and external-action container mounted by App Footer.
- **background-activity-footer-view.tsx**: Fixture-driven compact summary and multi-notice popover.
- **background-activity-footer-state.ts**: Stable identity, expiry filtering, priority ordering, and view-model projection.
- **background-activity-footer-store.ts**: Bounded persisted acknowledgement history.
- **background-activity-footer-view.stories.tsx**: Multi-notice footer fixture.
- **background-activity-footer-view.test.tsx**: Collapsed-footer and multi-notice acknowledgement interactions.
- **background-activity-footer-state.test.ts**: Ordering, acknowledgement, and expiry behavior.
