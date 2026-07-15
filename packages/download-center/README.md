# Download Center package

`@cradle/download-center` is the shared, host-agnostic artifact runner and contract. It deliberately does not own a database, IPC, HTTP routes, or a user-visible task list.

## Ownership boundary

- `contract.ts` defines the redacted `DownloadTaskView` shared by server, desktop, and web.
- `http-artifact-downloader.ts` streams HTTPS artifacts, enforces byte/checksum limits, resumes only strong-ETag partial transfers, and emits throttled progress.
- Server and Electron main own durable task lifecycle, storage roots, event fan-out, retry policy, and artifact release. Renderer code consumes only their redacted task projections.

`DownloadRequest` is host-internal. Its URLs and optional headers must never be persisted in a public task view or crossed into renderer IPC.

## Using the runner

Construct `HttpArtifactDownloader` in a trusted host, give it a host-owned storage root, and persist its `DownloadProgress` through that host's task service. Do not call it from web/renderer code.

```ts
const downloader = new HttpArtifactDownloader({
  rootDir: hostOwnedDownloadRoot,
  onProgress: progress => host.recordProgress(progress),
})

const result = await downloader.download({ taskId, request, signal })
```

The result's `filePath` is an internal artifact capability. A host releases it after promotion/installation; it is not an API response field.
