# @cradle/artifact

Constrained JSX component kit for **Cradle Agent Artifacts** — the Cursor Canvas analogue.

Agents author a `.tsx`-style source that imports **only** from `cradle/artifact` (optionally `react`). The Cradle host compiles and renders that source in the Browser Panel.

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
          { label: 'High risk', value: '3', caption: 'review first', sparkline: [12, 14, 11, 16, 18] },
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

## Rules

- Default-export a React component (or named `export default`).
- Import only `cradle/artifact` and optionally `react`.
- Do not import Cradle app modules, Electron, or network SDKs.

## Component inventory

| Component | Role |
| --- | --- |
| `Artifact` | Root shell (quiet document column) |
| `Header` | Eyebrow / title / summary / meta fragments |
| `Section` | Titled block; sections separate by space, not borders |
| `Metrics` | Quiet KPI strip with optional `delta` + `sparkline` per item |
| `DeltaBadge` | Trend indicator (`up` / `down` / `flat`) |
| `Sparkline` | Tiny trend line (recharts) |
| `BarChart` | Vertical bars with peak highlight and tooltip (recharts) |
| `LineChart` | Time-series area chart (recharts) |
| `DonutChart` | Share-of-total donut with legend rows (recharts) |
| `Gauge` | Percent radial gauge with center readout (recharts) |
| `ShareList` | Share-of-total progress rows |
| `Progress` | Determinate goal bar with percent |
| `Table` | Columnar data; right-aligned columns render as mono numerics |
| `List` | Item rows with status icons via `tone` |
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
| `Stack` / `HStack` / `Text` / `Divider` | Layout primitives |

## Design System contract

The kit renders inside an `Artifact` root and uses only host theme tokens
(`--card`, `--muted`, `--border`, `--foreground`, `--muted-foreground`,
`--success`/`--warning`/`--error`/`--info`, `--chart-1..5`) so every component
follows light/dark automatically. Charts resolve their accent through
`--viz-blue` (mapped to `--info`); multi-series colors come from the chart
palette. No raw palette colors, no decorative accents.

The complete component gallery is available in Storybook at
`Design System/Artifact Kit`.
