# Share workspace files from iOS

- **Date:** 2026-08-31
- **Problem:** Mobile could browse and preview workspace files, but the file remained trapped inside Cradle. Users could not send a log to a teammate, save a generated artifact, or open a source file in another iOS app.
- **Motivation:** The server already exposes original file bytes. Connecting that capability to the system share sheet turns the file browser from a read-only inspection surface into a useful handoff workflow.
- **Product behavior:** An iOS file preview now shows the standard Share item in its native navigation toolbar. Tapping it downloads the original file, preserving its filename and format, then opens the iOS share sheet. The action is disabled while downloading, works even when Cradle cannot render an inline preview, and shows a system alert if the file cannot be prepared.
- **Implementation:** The Mobile Container downloads `/workspaces/{workspaceId}/files/raw` into a dedicated app-cache directory with the existing server token supplied only as a request header. Expo FileSystem streams into a named local file and React Native hands its file URL to the native share sheet. Idempotent writes safely replace an earlier cached file with the same name.
- **Systems affected:** Mobile workspace file Container, iOS native navigation toolbar, local cache, and autonomous development journal.
- **Validation:** Mobile ESLint and TypeScript passed, and Expo production exports completed for iOS, Android, and Web.
- **Tradeoffs:** Prepared files remain in the operating-system-managed cache so share extensions can finish reading them. Same-named files reuse one cache location; iOS may evict cached files whenever storage is constrained.
- **Follow-up ideas:** Add cache pruning if usage shows meaningful accumulation, and consider Quick Look previews for image, PDF, and Office formats before sharing.
- **Out of scope:** Editing files, server changes, background downloads, progress percentages, custom share destinations, and Android/Web presentation changes.
