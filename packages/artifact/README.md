# @cradle/artifact

Constrained JSX component kit for **Cradle Agent Artifacts** — the Cursor Canvas analogue.

Agents author a `.tsx`-style source that imports **only** from `cradle/artifact` (optionally `react`). The Cradle host compiles and renders that source in the Browser Panel.

## Example

```tsx
import { Artifact, Header, MetricGrid, Section, Table, ActionButton } from 'cradle/artifact'

export default function ReviewBoard() {
  return (
    <Artifact>
      <Header
        eyebrow="PR Review"
        title="Priority changes"
        summary="Grouped by risk. Click through to dig into each cluster."
      />
      <MetricGrid
        items={[
          { label: 'Files', value: '24', meta: 'changed' },
          { label: 'High risk', value: '3', meta: 'review first' },
        ]}
      />
      <Section title="Clusters" flush>
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
