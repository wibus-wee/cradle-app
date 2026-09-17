# Managed Resources

This module owns the declaration catalog, redacted state projection, exact-key
lookup, and install/update/uninstall command dispatch for retained resources.

Owners register immutable declarations before HTTP routes accept requests and
provide adapters for dynamic state and commands. The catalog does not discover
releases, download bytes, extract archives, own installation storage, activate
runtimes, or remove files. Those semantics remain in Chronicle, OpenCode,
Codex, Claude Agent, and image-ocr owner namespaces.

The public key is the same `(namespace, resourceType, resourceId)` triple used
by related Download Center tasks. Web joins declarations and transfers only by
that exact identity. Download Center remains responsible for queueing, transfer,
verification, retry/resume, cancellation, temporary artifacts, and redacted
history.

Routes:

- `GET /managed-resources`
- `GET /managed-resources/:namespace/:resourceType/:resourceId`
- `POST /managed-resources/:namespace/:resourceType/:resourceId/install`
- `POST /managed-resources/:namespace/:resourceType/:resourceId/update`
- `DELETE /managed-resources/:namespace/:resourceType/:resourceId`

Command routes accept only the exact resource key and action. They never accept
a URL, checksum, version, archive name, source headers, or filesystem path.
