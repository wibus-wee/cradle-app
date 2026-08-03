import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  ActionButton,
  Artifact,
  ArtifactActionProvider,
  BarChart,
  Callout,
  Header,
  List,
  MetricGrid,
  Section,
  SegmentedBar,
  Table,
} from '@cradle/artifact'

function ArtifactKitGallery() {
  return (
    <main className="min-h-screen bg-[var(--color-sidebar)] p-4 text-[var(--text-primary)]">
      <div className="relative mx-auto h-[780px] max-w-3xl overflow-hidden rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
        <ArtifactActionProvider value={{ runPrompt: () => true }}>
          <Artifact>
            <Header
              eyebrow="Artifact kit · Design System"
              title="Attention report"
              summary="Every primitive stays on semantic tokens, restrained borders, and Cradle's medium-density rhythm."
            />
            <MetricGrid
              items={[
                { label: 'Open items', value: '24', meta: 'across 6 groups' },
                { label: 'High risk', value: '3', meta: 'review first' },
                { label: 'Agent source', value: '8', meta: 'semantic accent' },
                { label: 'Coverage', value: '92%', meta: 'last 24 hours' },
              ]}
            />
            <Section title="Signal" description="Status colors carry meaning; they are never decoration.">
              <Callout title="Review window" tone="info">
                Three changes need a human decision before the next run.
              </Callout>
              <SegmentedBar
                className="mt-4"
                segments={[
                  { label: 'Workspace', value: 8, tone: 'workspace' },
                  { label: 'Agent', value: 5, tone: 'agent' },
                  { label: 'Summary', value: 3, tone: 'summary' },
                  { label: 'Scope', value: 2, tone: 'scope' },
                ]}
              />
            </Section>
            <Section title="Clusters" description="Quiet rows, tokenized hierarchy, no ornamental cards.">
              <Table
                columns={[
                  { key: 'area', header: 'Area' },
                  { key: 'risk', header: 'Risk', align: 'right' },
                  { key: 'files', header: 'Files', align: 'right' },
                ]}
                rows={[
                  { area: 'runtime', risk: 'high', files: 8 },
                  { area: 'browser', risk: 'medium', files: 5 },
                  { area: 'design system', risk: 'low', files: 11 },
                ]}
              />
              <div className="mt-4">
                <List
                  items={[
                    { title: 'Runtime boundary', description: 'Needs a second pass', meta: '3 open', tone: 'warning' },
                    { title: 'Browser surface', description: 'Stable in latest build', meta: '8 done', tone: 'success' },
                  ]}
                />
              </div>
            </Section>
            <Section title="Distribution" flush>
              <BarChart
                items={[
                  { label: 'Mon', value: 12 },
                  { label: 'Tue', value: 18 },
                  { label: 'Wed', value: 14 },
                  { label: 'Thu', value: 24 },
                  { label: 'Fri', value: 20 },
                ]}
                height={96}
              />
              <div className="mt-4 flex items-center gap-2">
                <ActionButton prompt="Explain the highest-risk cluster." variant="primary">
                  Explain the risk
                </ActionButton>
                <ActionButton prompt="Open the report details." variant="secondary">
                  Open details
                </ActionButton>
              </div>
            </Section>
          </Artifact>
        </ArtifactActionProvider>
      </div>
    </main>
  )
}

const meta = {
  title: 'Design System/Artifact Kit',
  component: ArtifactKitGallery,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'The canonical gallery for the constrained JSX Artifact kit. It is intentionally rendered in both themes.',
      },
    },
  },
} satisfies Meta<typeof ArtifactKitGallery>

export default meta

type Story = StoryObj<typeof meta>

export const Gallery: Story = {}
