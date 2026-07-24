<!-- Once this directory changes, update this README.md -->

# components/common

`components/common` 归属 Cradle web app 的共享 UI 层。这里放置跨 feature 复用、但仍带有 Cradle app 语义的组件；业务数据读取、mutation、store ownership 仍应留在对应 `features/{domain}`。

## Placement Boundaries

- 放在 `components/common`：app-specific fallback、empty state composition、app chrome helper、跨功能但不拥有业务数据的共享组件。
- 放在 `components/ui`：跨应用可复用、低业务语义、design-system primitive 级组件。
- 放在 `features/{domain}`：拥有业务语义、数据访问、生命周期或特定 domain copy 的组件。

## Files

- **app-error-boundary.tsx**: App-wide React error boundary with a restrained fallback for renderer crashes; it logs caught render errors, allows history back, local retry, and full reload actions, and only shows stack details in development.
- **beta-notice.tsx**: Shared app-level Beta/unstable feature notice. It owns the restrained warning treatment while callers provide feature-specific localized title and description copy.
- **diff/**: Shared Cradle diff-rendering module. It owns Pierre worker/highlighter setup, patch parsing and path indexing, standard rendering options, layout controls, read-only patch rendering, and before/after content rendering. Feature modules retain data fetching and domain interactions such as review threads.
- **workspace-file-icon.tsx**: Shared workspace file icon renderer backed by the `@pierre/trees` built-in complete icon resolver and sprite sheet, reused by file mentions and Git change rows.
