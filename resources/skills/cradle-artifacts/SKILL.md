---
name: cradle-artifacts
description: Use when creating or updating Cradle Agent Artifacts via write_artifact — interactive JSX dashboards, audits, review boards, charts, and tables rendered beside chat. Prefer this over dumping structured UI as markdown. Covers cradle/artifact imports, export default, component inventory, artifactId reuse, and ActionButton prompts.
---

# Cradle Artifacts

Use `write_artifact` to publish an interactive JSX view in the chat side panel (Cursor Canvas analogue). Prefer Artifacts when a structured UI is clearer than markdown prose.

## When To Use

| Prefer `write_artifact` | Prefer markdown / chat text |
| --- | --- |
| Dashboards, audits, review boards | Short answers, prose explanations |
| Charts, metric grids, comparison tables | Simple lists or one-off code snippets |
| Click-through follow-ups via ActionButton | One-shot status updates |
| Living docs the user revisits / refreshes | Throwaway notes |

After writing, tell the user the Artifact is in the side panel. Do **not** dump the full JSX into chat.

The tool result is **metadata-only** (`artifactId`, `sessionId`, `title`, `revision`, …). Full JSX is persisted server-side and loaded by the panel — do not expect `source` in the tool result.

## Tool

```text
write_artifact
  title: string          # panel tab + chat card label
  source: string         # full JSX module
  artifactId?: string    # omit to create; reuse to update (revision++)
```

Ambient session comes from `CRADLE_CHAT_SESSION_ID`. No separate session id arg.

## Authoring Rules

1. Import **only** from `cradle/artifact` (optionally `react`). No app modules, Electron, fs, network SDKs, or dynamic imports.
2. `export default` a React component (required).
3. Compose with the kit below — do not invent host components.

## Component Inventory

| Component | Role |
| --- | --- |
| `Artifact` | Root shell (quiet document column) |
| `Header` | Eyebrow / title / summary / meta fragments |
| `Section` | Titled block; sections separate by space, not borders |
| `Metrics` | Quiet KPI strip — big tabular values, optional `delta` + `sparkline: number[]` |
| `DeltaBadge` | Trend indicator (`up` / `down` / `flat` + pre-formatted label) |
| `Sparkline` | Tiny trend line for recent values |
| `BarChart` | Vertical bars, peak highlighted, hover tooltip |
| `LineChart` | Time-series area chart |
| `DonutChart` | Share-of-total donut with legend rows |
| `Gauge` | Percent radial gauge with center readout |
| `ShareList` | Share-of-total progress rows (label + track + value + %) |
| `Progress` | Determinate goal bar with percent |
| `Table` | Columnar data; right-aligned columns render as mono numerics |
| `List` | Item rows with status icons via `tone` (`info`/`success`/`warning`/`danger`) |
| `Timeline` | Vertical event stream with tone ticks and meta |
| `Steps` | Horizontal workflow indicator (`done`/`current`/`upcoming`) |
| `Callout` | Highlight / warning wash with tone icon |
| `Badge` | Compact status chip |
| `KeyValue` | Label/value metadata rows |
| `CodeBlock` | Mono snippet well with optional title + language badge |
| `Collapsible` | Expandable block for long secondary content |
| `Tabs` | View-local tab switcher (content passed inline) |
| `EmptyState` | Quiet placeholder for empty collections |
| `ActionButton` | Sends `prompt` into the owning chat |
| `Stack` / `HStack` | Layout |
| `Text` | Body copy |
| `Divider` | Separator |

Prefer real visualizations over prose or color-coded text: give `Metrics` sparklines, use `BarChart`/`LineChart` for series, `DonutChart`/`ShareList` for share-of-total.

## Updates

Reuse the same `artifactId` from a prior `write_artifact` result to revise in place. Revision increments; the panel refreshes by id. Omit `artifactId` only when creating a new Artifact.

## ActionButton Pattern

```tsx
<ActionButton prompt="Explain the high-risk auth changes in detail.">
  Dig into auth
</ActionButton>
```

`prompt` is required. Click injects that text into the session composer/run — use concrete follow-up asks, not vague labels.

## Example

```tsx
import { Artifact, Header, Metrics, Section, Table, ActionButton } from 'cradle/artifact'

export default function ReviewBoard() {
  return (
    <Artifact>
      <Header
        eyebrow="PR Review"
        title="Priority changes"
        summary="Grouped by risk. Click through to dig into each cluster."
      />
      <Metrics
        items={[
          { label: 'Files', value: '24', caption: 'changed' },
          { label: 'High risk', value: '3', caption: 'review first' },
        ]}
      />
      <Section title="Clusters">
        <Table
          columns={[
            { key: 'area', header: 'Area' },
            { key: 'risk', header: 'Risk', align: 'right' },
          ]}
          rows={[
            { area: 'auth', risk: 'high' },
            { area: 'ui', risk: 'low' },
          ]}
        />
        <ActionButton prompt="Explain the high-risk auth changes in detail.">
          Dig into auth
        </ActionButton>
      </Section>
    </Artifact>
  )
}
```

Pass that source to `write_artifact` with a short `title`. On later turns, pass the returned `artifactId` to update.
