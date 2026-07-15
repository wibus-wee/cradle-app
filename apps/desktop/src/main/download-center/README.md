# Desktop Download Center

Electron main owns desktop-scoped download execution and durable, redacted task state in this directory. `download-center-service.ts` queues ordinary artifacts through the shared `HttpArtifactDownloader`; `download-task-store.ts` persists only task views and resume metadata below Electron user data.

The preload contract exposes list, get, cancel, and task-change events. It never exposes request URLs, headers, artifact paths, or retry inputs. Feature owners such as the macOS updater construct trusted requests in main, promote the returned artifact, and release it. Windows NSIS remains transported by `electron-updater`, whose external progress is projected into the same task lifecycle.
