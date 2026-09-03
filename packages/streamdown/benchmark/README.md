# Streamdown vs Markstream React Benchmark

This benchmark evaluates whether Cradle should replace `@cradle/streamdown` with `markstream-react`. It measures browser rendering rather than parser-only microbenchmarks and checks the Cradle-specific contracts that a replacement must preserve.

## Decision

Do not replace `@cradle/streamdown` wholesale with `markstream-react@2.0.6` yet.

Markstream produces a substantially smaller production bundle, uses 32% less main-thread work in the typical stream, and reduces the longest blocked frame for long documents. Those wins do not offset the current replacement blockers: about 1.9x main-thread work for completed Markdown, a 2.1 second final drain even in the typical stream, 4.4x main-thread work under sustained backlog, and a reproducible React maximum-update-depth failure under synchronous burst updates. A migration would also require new adapters for Cradle directives, asset URLs, per-render component overrides, and animation semantics.

| Decision area                | Outcome               | Evidence                                                                                                       |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Completed Markdown           | Keep Cradle           | Markstream used 1.9x task time, 1.5x retained heap, and 4.1x DOM elements.                                     |
| Typical streaming            | Tradeoff; keep Cradle | Markstream used 32% less task time but took 2,052 ms to settle after ingestion and created about 6.8x the DOM. |
| Backlogged streaming         | Keep Cradle           | Markstream used 4.4x total task time and took 8,329 ms to settle after ingestion.                              |
| Extreme burst updates        | Blocked               | Markstream failed all 5 measured samples under React 19.                                                       |
| Long-document responsiveness | Markstream advantage  | Its first commit was 83% faster and its maximum frame gap was 67% lower through virtualization.                |
| Bundle size                  | Markstream advantage  | Entry gzip was 68% smaller and total emitted gzip was 64% smaller.                                             |
| Migration surface            | Adapter required      | Cradle relies on renderer props and Markdown extensions that are not drop-in compatible.                       |

## Benchmark Matrix

| Scenario            | Input and update model                                                | Renderer configuration                                                                      | Question answered                                                                |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `completed`         | 12,000-character mixed Markdown, one commit                           | Animations, virtualization, deferred nodes, and rich code rendering disabled                | What does an equivalent complete DOM cost?                                       |
| `typical-stream`    | 2,500 characters, 16-character chunks every 67 ms (about 240 chars/s) | Cradle's current balanced character animation vs Markstream's documented chat configuration | What do short, ordinary assistant responses cost?                                |
| `paced-production`  | 8,000 characters, 64-character chunks every 16 ms (4,000 chars/s)     | The same production configurations under a sustained backlog                                | How do the recommended streaming paths behave when input outruns visible output? |
| `burst-full-render` | 48,000 characters, 512-character synchronous commits with no delay    | Both render every prefix without smoothing or virtualization                                | What is the worst full-render update throughput and failure behavior?            |
| `long-document`     | 160,000 characters, one commit                                        | Cradle full DOM vs Markstream default live-node virtualization                              | What tradeoff does Markstream's long-document architecture make?                 |
| Production bundle   | Separate Vite production builds, React externalized                   | Package styles included; all emitted lazy chunks and assets counted                         | What renderer payload would the app ship beyond React?                           |

The deterministic fixture contains headings, paragraphs, inline formatting, links, lists, blockquotes, tables, and TypeScript fences. Runtime code highlighting is normalized to plain `pre`/`code` elements so Shiki or `stream-diffs` startup does not dominate the renderer comparison.

## Results

The tables report the median of five measured samples after one warmup. Wall and task values are milliseconds. CPU is Chromium renderer `TaskDuration / wall time`, so it represents main-thread occupancy during the scenario rather than whole-system CPU usage. Heap is the live JS heap delta after forced garbage collection.

### Completed Markdown

| Renderer   | Wall | Task |   CPU |    Heap | DOM elements | Max frame gap |
| ---------- | ---: | ---: | ----: | ------: | -----------: | ------------: |
| Cradle     |  164 |   59 | 35.1% | 1.7 MiB |          530 |            46 |
| Markstream |  232 |  114 | 49.5% | 2.6 MiB |        2,155 |            81 |

Markstream's node wrappers and renderer structure generate about four times as many elements for the same visible document. Its p95 wall time was 238 ms versus 173 ms for Cradle, so the median difference was not a single outlier.

### Typical Streaming

| Renderer   | Total wall | Ingestion | Final settle |  Task |   CPU |    Heap | DOM elements |
| ---------- | ---------: | --------: | -----------: | ----: | ----: | ------: | -----------: |
| Cradle     |     12,971 |    12,844 |          123 | 1,957 | 15.1% | 3.9 MiB |          127 |
| Markstream |     14,902 |    12,856 |        2,052 | 1,322 |  8.8% | 3.5 MiB |          861 |

At an ordinary short-response rate, Markstream did 32% less total main-thread work and retained 10% less JS heap. Both stayed below a 50 ms frame gap. Markstream nevertheless delayed the completed state by about two seconds while its smooth-stream controller drained the remaining visible backlog, increasing total wall time by 15%. Its rendered structure also used about 6.8 times as many elements.

### Backlogged Production Streaming

| Renderer   | Total wall | Ingestion | Final settle |  Task |   CPU |    Heap | Max frame gap |
| ---------- | ---------: | --------: | -----------: | ----: | ----: | ------: | ------------: |
| Cradle     |      2,381 |     2,252 |          123 |   382 | 16.1% | 3.3 MiB |            26 |
| Markstream |     10,562 |     2,231 |        8,329 | 1,667 | 15.8% | 4.4 MiB |            27 |

Both renderers stayed below a 50 ms frame gap while chunks arrived. Markstream's similar average CPU percentage is misleading by itself: it kept the renderer active much longer and consumed 4.4 times the total main-thread work. Its smooth-stream controller continued draining the visible backlog after `final`, while Cradle immediately switched to its completed renderer.

### Burst Full Rendering

| Renderer   | Successful samples |  Wall |  Task |   CPU | Max frame gap | Outcome                                         |
| ---------- | -----------------: | ----: | ----: | ----: | ------------: | ----------------------------------------------- |
| Cradle     |                5/5 | 2,493 | 2,388 | 96.0% |         2,378 | Completed with one expected long blocking task. |
| Markstream |                0/5 |     - |     - |     - |             - | React threw `Maximum update depth exceeded`.    |

This is an intentionally adversarial synchronous-commit test, not a model of paced SSE delivery. It is still a replacement blocker because a renderer must fail by slowing down or applying backpressure, not by taking down the React subtree.

### Long Document

| Renderer   | Total wall | Initial commit | Task |    Heap | DOM elements | Visible text | Max frame gap |
| ---------- | ---------: | -------------: | ---: | ------: | -----------: | -----------: | ------------: |
| Cradle     |        403 |            262 |  313 | 1.8 MiB |        6,637 |      137,503 |           306 |
| Markstream |        862 |             45 |  670 | 3.3 MiB |        4,003 |       19,406 |           102 |

Markstream committed its initial virtualized window 5.8 times faster and split work into shorter tasks. Total work and wall time were higher, and only the live window was mounted, so its DOM and visible-text counts are not equivalent to Cradle's complete document. Before using this path, Cradle would need product checks for browser find, copy/select-all, accessibility traversal, scroll restoration, and variable-height correction.

### Production Bundle

| Renderer   | Entry raw | Entry gzip | All output raw | All output gzip | Files |
| ---------- | --------: | ---------: | -------------: | --------------: | ----: |
| Cradle     |  2.03 MiB |    632 KiB |      14.24 MiB |        3.24 MiB |   418 |
| Markstream |   614 KiB |    201 KiB |       3.98 MiB |        1.16 MiB |   121 |

React and React DOM are externalized from both builds. "All output" includes lazy chunks, workers, CSS, and assets. The current repository already provides Markstream's optional Mermaid and KaTeX peers through Streamdown, so the result reflects the dependency graph a direct replacement would encounter here. Cradle's built-in Shiki, Mermaid, and language assets explain much of its total output; lazy and optional loading are actionable optimizations even without changing renderers.

## Compatibility Assessment

| Contract            | Cradle today                                                   | Markstream React                                                  | Migration consequence                                                                              |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Incomplete Markdown | Tail repair plus stable completed blocks                       | Streaming parser with loading and auto-closed nodes               | Both cover the base case; visual and malformed-input parity still needs fixtures.                  |
| Component overrides | Per-render `react-markdown` HTML component map                 | Parser-node components, scoped registry, or per-render node maps  | Every custom component needs a new node-based adapter.                                             |
| Markdown extensions | Per-render remark and rehype plugin lists                      | `markdown-it` parser hooks and custom tags                        | `code-comment` and `commit-group` directives need a new parser owner and fixtures.                 |
| Owned URL schemes   | `urlTransform`, `MarkdownLink`, and `cradle-asset://` handling | Safe URL policy plus custom Link/Image nodes                      | Asset links and images need explicit custom nodes; default policy will not preserve owned schemes. |
| Code blocks         | Built-in Shiki queue, copy UI, and Mermaid dispatch            | Plain `pre` fallback or optional `stream-diffs`; optional Mermaid | Product behavior and bundle choices must be selected explicitly.                                   |
| Math and Mermaid    | Built in and loaded by package components                      | Supported through optional peers and workers                      | Feature parity is feasible but requires visual and security verification.                          |
| Reveal animation    | Persistent character births, char/word mode, named presets     | Typewriter and fade state                                         | Existing Cradle animation settings do not map directly.                                            |
| Long documents      | Full DOM                                                       | Live-node virtualization and deferred heavy nodes                 | Markstream is more responsive, with find/copy/accessibility tradeoffs to validate.                 |
| Security            | `rehype-sanitize` plus owned URL transform                     | Safe HTML policy and URL filtering by default                     | Both have safe defaults; Cradle protocols require policy integration.                              |
| Package utilities   | Renderer, scroll helpers, error boundaries, and profiler       | Renderer-centric React API and debug timing                       | Replacing the package still requires a Cradle facade for non-renderer exports.                     |

## Replacement Gates

A future Markstream trial should meet all of these conditions before becoming the default:

1. The React 19 burst case completes without an update-depth error in every sample.
2. Paced final-settle latency is bounded independently of response length and does not delay completed Markdown by seconds.
3. `code-comment`, `commit-group`, Markdown file links, link cards, and `cradle-asset://` images have fixture-driven adapters.
4. Completed and streaming fixtures receive security, malformed-Markdown, and visual parity review.
5. Virtualized transcripts pass keyboard navigation, screen-reader traversal, selection/copy, browser find, scroll restoration, and dynamic-height checks.
6. The same harness shows a primary-path performance win, not only a bundle-size win.

Until those gates pass, the lower-risk work is to keep the Cradle API and target its measurable weaknesses: lazy-load Shiki and Mermaid assets, add a long-document rendering boundary, and reduce the burst path's single blocking commit.

## Reproduce

Prerequisites are the repository's pinned Node and pnpm toolchain plus a local Google Chrome installation. Run from the repository root:

```bash
pnpm install
pnpm --filter @cradle/streamdown benchmark:typecheck
pnpm --filter @cradle/streamdown benchmark -- --samples 5 --warmups 1
```

The runner starts an isolated Vite server, opens a fresh Chrome page for each sample, forces garbage collection around heap measurements, and writes JSON to `benchmark/results/latest.json`. Use `--output benchmark/results/<name>.json` to preserve a named run.

The checked-in reference run is [`results/2026-08-28-apple-m4-max.json`](./results/2026-08-28-apple-m4-max.json). It used `@cradle/streamdown@0.1.0`, `markstream-react@2.0.6`, React 19.2.3, Chrome 151.0.7922.174, Node 26.7.0, and an Apple M4 Max with 36 GiB memory on macOS 26.5. Raw results include all samples, p95 values, environment metadata, emitted bundle files, and failure stacks.

## Limits

This benchmark does not establish Markdown semantic equivalence. It deliberately excludes rich code highlighting and diagrams from runtime scenarios, does not measure image or worker startup, and does not exercise a full transcript with tool blocks and scroll anchoring. Results are local-machine comparisons, not universal latency promises; compare ratios and failure behavior, and rerun after either renderer or Chrome changes.
