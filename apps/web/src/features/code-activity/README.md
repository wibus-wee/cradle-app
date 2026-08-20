# Features/Code Activity

Code Activity owns the metadata-only projection that web plugins may consume.
It converts Cradle's internal UI presence into `code.heartbeat` events only
while the user is active in a workspace-bound chat. Visible workspace files
produce non-write heartbeats. In-memory editor changes and the dedicated
session execution-root stream produce write heartbeats, so AI runtimes,
terminals, external tools, and the built-in editor share the same projection.
For isolated Work sessions the execution root is the managed worktree. The
plugin projection never reads file content and never includes absolute paths or
chat/session identifiers.

`code-activity-bus.ts` owns current-target state, live delivery, late-subscriber
snapshots, and handler isolation. `code-activity-events.ts` consumes the
metadata-only server stream. `code-activity-resolver.ts` joins the active
workspace-file tab to public workspace identity. `code-activity-runtime.tsx`
gates both UI and filesystem facts before publishing to the dedicated bus.
Plugin permission and capability enforcement remains in
`lib/web-code-activity-registry.ts`.
