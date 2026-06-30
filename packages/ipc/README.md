<!-- Once this directory changes, update this README.md -->

# Packages/Ipc

Shared IPC framework used by the Electron main and renderer processes lives here.
This package provides typed proxies, service registration, and request-scoped IPC instrumentation.
Keep the public exports small because app code in both processes depends on them.

## Files

- **package.json**: Workspace package manifest for `@cradle/ipc`.
- **src/**: Source files for the shared IPC framework and tracing helpers.
- **tsconfig.json**: TypeScript configuration for the package.
