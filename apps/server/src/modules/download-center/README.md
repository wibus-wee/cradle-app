# Server Download Center

This module owns the Server Download Center: durable server-scoped task state, queue admission, cancellation, retry eligibility, cleanup, and the redacted HTTP/CLI projection for artifact downloads. `@cradle/download-center` owns only the reusable HTTPS transfer runner and contract; Chronicle, plugin sources, and future server features own their request construction and artifact promotion.

## Lifecycle and storage

`DownloadCenterService` starts from `apps/server/src/app.ts`, marks interrupted active tasks terminal at boot, and is registered in the runtime resource registry for shutdown cancellation. It stores durable task metadata through the Download Center Drizzle schema and artifacts below `<server data dir>/download-center`. Completed artifacts are retained only until their owner promotes/releases them; periodic cleanup removes expired material.

The database stores a redacted task projection: owner identity, file name, byte counts, state, retryable error code/message, and checksum result. Source URLs, request headers, and resume details are execution-only data and never enter the task table, HTTP response, SSE event, logs, or CLI output.

## Internal and public API

`execute`, `retry`, and `release` are internal host capabilities. A feature constructs a bounded HTTPS `DownloadRequest`, awaits its artifact, verifies/promotes it in the feature's namespace, then releases it. A task must not be treated as a general-purpose file-serving record.

Public routes are intentionally read/control only:

- `GET /download-center/tasks` and `GET /download-center/tasks/:id`
- `POST /download-center/tasks/:id/cancel`
- `GET /download-center/events` for changes after the caller has fetched an initial list snapshot

The first three routes expose CLI metadata. Creation and artifact access stay internal to prevent callers from supplying arbitrary URLs or receiving filesystem paths.

## Future runtime example

A future server runtime should depend on this module at its composition boundary, not create another downloader or progress endpoint:

```ts
const artifact = await downloadCenter.execute({
  owner: { namespace: 'runtime-x', resourceType: 'model', resourceId, displayName },
  fileName: 'model.bin',
  sources: [{ id: 'publisher', url }],
  integrity: { expectedBytes, checksum: { algorithm: 'sha256', value: sha256 } },
  maxBytes: expectedBytes,
})
try {
  await promoteIntoRuntimeOwnedStorage(artifact.filePath)
} finally {
  await downloadCenter.release(artifact.taskId)
}
```

Only trusted server code may construct that request. A renderer requests a feature action and observes its task through Download Center; it never passes a download URL.
