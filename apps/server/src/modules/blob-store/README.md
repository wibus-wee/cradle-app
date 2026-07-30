# Blob Store Module

Content-addressed byte storage under the server data directory. This module owns
deduplication by `(content hash, media type)`, the `blobs` metadata index,
filesystem layout (`blobs/<sha[0:2]>/<sha>-<media-type-hash>`), HTTP metadata
and content serving, and garbage collection of unreferenced blobs. Media type is
part of the stored representation identity so two callers cannot assign
different response types to the same bytes. The store owns **no** policy: no
image re-encoding, no size limits beyond what callers impose, and no media-type
validation. Owners keep their own policy and their own reference tables (for
chat: `chat_message_blob_refs`).

## Deliberate deferral: two byte stores

`assets` still writes its own files under `assets/…` and is not a blob-store
consumer. Unifying those paths would require an `ALTER TABLE assets`, behavior
changes to `deleteAsset`, and test churn that contribute nothing to chat payload
externalization. The duplication is documented debt, not an accident.

## Files

- `index.ts`: Elysia `/blobs` routes for metadata and content reads. There is no
  upload route — bytes enter only through server-side `putBlob` callers.
- `model.ts`: TypeBox schemas for blob metadata responses.
- `service.ts`: Content-addressed `putBlob` / `getBlob` / `readBlobBytes`, path
  sandboxing under the Cradle data directory.
- `gc.ts`: Background Activity maintenance task that drops orphan refs (Phase A)
  and collects unreferenced blobs past the grace period (Phase B).

## Garbage collection

Chat claims blob + ref in one SQLite transaction, then commits the owning message.
`CRADLE_BLOB_GC_GRACE_SECONDS` protects the remaining ref → message window and
abandoned writes. The one-hour default is also the enforced minimum: operators
may extend it, but a smaller value is clamped to 3600 so configuration cannot
invalidate the write-order safety contract.
