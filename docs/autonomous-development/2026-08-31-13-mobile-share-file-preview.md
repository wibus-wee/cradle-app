# Share mobile workspace file previews

- **Date:** 2026-08-31
- **Problem:** Mobile users could inspect workspace text and Markdown files but could not move their contents into Messages, Notes, email, or another app without manually selecting text.
- **Motivation:** Sharing is a native phone workflow and turns read-only workspace access into a practical handoff while away from the desktop.
- **Product behavior:** Supported file previews now show a Share icon. It opens the system share sheet with the relative path followed by the loaded file content; native failures surface in an alert. Unsupported formats do not show the action.
- **Implementation summary:** Added a callback to the fixture-driven File Preview View and kept React Native `Share` and `Alert` ownership in the Container. No extra request is made because the preview content is already loaded.
- **Files / systems affected:** Mobile File Preview View/container/fixtures, mobile architecture documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** Content is shared as text rather than a file attachment because Cradle Mobile does not own a local file cache or authenticated shareable URL. Very large text files depend on platform share-sheet limits.
- **Follow-up ideas:** Add authenticated temporary file export only if users need original filenames, MIME types, or binary sharing.
