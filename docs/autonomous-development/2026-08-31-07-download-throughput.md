# Show average download throughput

- **Date:** 2026-08-31
- **Problem:** Download rows showed bytes and completion percentage, but gave no indication of how quickly a large runtime or model was transferring.
- **Motivation:** Throughput helps users distinguish a healthy long-running transfer from one that is barely progressing.
- **Product behavior:** While a task is downloading and has valid progress timestamps, its row shows an explicitly labeled average transfer rate alongside bytes and percentage. Queued, verifying, and invalid or zero-progress states omit the rate.
- **Implementation summary:** Added a pure presentation helper that divides reported bytes by the elapsed interval between `startedAt` and `updatedAt`, then reused the existing compact byte formatter in the fixture-driven row View.
- **Files / systems affected:** Web Download Center presentation and row View, Chrome locale resources, and Download Center documentation.
- **Validation performed:** Focused Download Center projection tests, web TypeScript checking, ESLint on changed source files, and locale JSON parsing.
- **Tradeoffs:** This is a lifetime average based on host-reported updates, not a sampled instantaneous rate. Labeling it as average avoids overstating precision without adding a timer or transfer-history subsystem.
- **Follow-up ideas:** If hosts later expose sampled rates, add remaining-time estimates only after validating their stability during retries and resumed downloads.
