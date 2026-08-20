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
| `Artifact` | Root shell |
| `Header` | Eyebrow / title / summary |
| `MetricGrid` / `MetricCell` | KPI row |
| `Section` | Titled block (`flush` for tight tables) |
| `SegmentedBar` | Proportional segments |
| `Table` | Columnar data |
| `List` | Simple item list |
| `Callout` | Highlight / warning |
| `BarChart` | Bar series |
| `ActionButton` | Sends `prompt` into the owning chat |
| `Stack` / `HStack` | Layout |
| `Text` | Body copy |
| `Divider` | Separator |

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

Pass that source to `write_artifact` with a short `title`. On later turns, pass the returned `artifactId` to update.
