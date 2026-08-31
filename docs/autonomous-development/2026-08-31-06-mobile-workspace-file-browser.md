# Browse workspace files on Mobile

- **Date:** 2026-08-31
- **Problem:** Workspace file rows were visible on Mobile but inert, so users could not inspect project files away from the desktop.
- **Motivation:** Read-only code inspection is a natural companion to remote Work and pull request control.
- **Product behavior:** Tapping a directory now opens a drill-down browser, while tapping a text or Markdown file opens a selectable preview. Oversized and unsupported files explain why no preview is available.
- **Implementation:** New container and view modules use the existing directory, metadata, and content contracts. Preview reads are restricted to text-like files no larger than 128 KiB, and navigation state stays local to the browser route.
- **Systems affected:** Mobile workspace navigation, project file rows, and new fixture-renderable file browser surfaces.
- **Validation:** Mobile TypeScript, targeted ESLint, and route-level static checks.
- **Tradeoffs:** The first version is intentionally read-only and does not subscribe to live filesystem events.
- **Follow-up ideas:** Add workspace file search and richer image/PDF previews as separate bounded improvements.
- **Out of scope:** File editing, binary downloads, live file watching, and server contract changes.
