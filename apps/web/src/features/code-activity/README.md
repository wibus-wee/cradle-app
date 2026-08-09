# Features/Code Activity

Code Activity owns the metadata-only projection that web plugins may consume.
It converts Cradle's internal UI presence into `code.heartbeat` events only
when a workspace file is visible on the active chat surface. Editor changes
produce write heartbeats. The projection never reads file content and never
includes absolute paths or chat/session identifiers.

`code-activity-bus.ts` owns current-target state, live delivery, late-subscriber
snapshots, and handler isolation. `code-activity-resolver.ts` joins the active
workspace-file tab to public workspace identity. `code-activity-runtime.tsx`
bridges internal UI activity into the dedicated bus. Plugin permission and
capability enforcement remains in `lib/web-code-activity-registry.ts`.
