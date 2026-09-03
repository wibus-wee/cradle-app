# Preview workspace files with iOS Quick Look

- **Date:** 2026-08-31
- **Problem:** Mobile could render text files and share original files, but users had no in-app way to inspect PDFs, images, Office documents, and other common workspace artifacts.
- **Motivation:** Quick Look is the standard iOS file-preview workflow and exposes capabilities the system already provides without building parallel renderers.
- **Product behavior:** An iOS file detail now offers Quick Look beside Share. Cradle downloads the authenticated original to its cache, confirms iOS supports the file type, and opens the system preview. Download and unsupported-format failures produce a clear alert.
- **Implementation summary:** Added a small Expo native module backed by `QLPreviewController`, a platform-resolved TypeScript bridge, and a shared authenticated file downloader for preview and sharing. The module retains its preview data source until dismissal.
- **Files / systems affected:** Mobile workspace file detail, cache downloads, and the iOS native module layer.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, diff whitespace validation, and an Xcode iOS Simulator build against the iOS 27 SDK with the new Swift module compiled for arm64 and x86_64.
- **Tradeoffs:** Preview availability follows the formats installed iOS Quick Look supports. Files are downloaded before presentation and remain in the app's temporary cache for normal system cleanup.
- **Follow-up ideas:** Add multi-file preview navigation when workspace selection supports batches, and surface download progress for unusually large artifacts.
- **Out of scope:** Custom document renderers, editing, Android previews, desktop/web behavior, and persistent offline file storage.
