# Packages/Streamdown

Streamdown is Cradle's Markdown rendering package for streaming chat output. It owns Markdown AST typing, static rendering, and React stream rendering primitives used by the web app.

| Area                   | Location                                                       | Responsibility                                                                                          | Key relationships                                                        |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Public API             | [`src/index.ts`](./src/index.ts)                               | Exposes renderers, extension hooks, scroll helpers, profiling, and owned types.                         | Consumed by the web app through `@cradle/streamdown`.                    |
| Completed rendering    | [`src/static-render.tsx`](./src/static-render.tsx)             | Renders complete Markdown through `react-markdown` with the package's safety and presentation defaults. | Accepts per-render components and remark/rehype extensions.              |
| Streaming rendering    | [`src/streamdown.tsx`](./src/streamdown.tsx)                   | Selects completed, animated streaming, or plain-text overload behavior.                                 | Delegates animated streams to the incremental renderer.                  |
| Incremental pipeline   | [`src/streamdown-render.tsx`](./src/streamdown-render.tsx)     | Smooths incoming content, preserves stable block identities, and coordinates reveal state.              | Uses the queue and smoother hooks under `src/hooks`.                     |
| Markdown dialect       | [`src/plugins`](./src/plugins)                                 | Owns incomplete-Markdown repair, safe HTML, and Cradle directive plugins.                               | Chat renders `code-comment` and `commit-group` through these extensions. |
| Rendering integrations | [`src/components`](./src/components)                           | Owns links, code highlighting, Mermaid, citations, and error boundaries.                                | Static and streaming blocks share these components.                      |
| Scroll and diagnostics | [`src/scroll`](./src/scroll), [`src/profiler`](./src/profiler) | Provides chat scroll behavior and renderer instrumentation.                                             | Exported independently of the Markdown components.                       |
| Comparative benchmark  | [`benchmark`](./benchmark)                                     | Measures browser runtime, main-thread CPU, retained heap, DOM size, and production bundle output.       | Pins the comparison dependency and records machine-readable results.     |

## Rendering Flow

Completed content goes directly through `StaticRender`. Active animated content is smoothed before incremental tokenization; completed blocks retain stable offsets and React identities while only the active tail is reparsed. The web app disables animated streaming for messages above its own size threshold, but completion still switches to full Markdown rendering.

Application-specific semantics stay at the renderer boundary. Consumers may supply React Markdown components, URL transforms, and remark or rehype plugins without moving route, store, or session dependencies into this package.

## Benchmark

The [Markstream React comparison](./benchmark) contains the methodology, raw measurements, compatibility assessment, and replacement recommendation. Reproduce it with:

```bash
pnpm --filter @cradle/streamdown benchmark:typecheck
pnpm --filter @cradle/streamdown benchmark -- --samples 5 --warmups 1
```
