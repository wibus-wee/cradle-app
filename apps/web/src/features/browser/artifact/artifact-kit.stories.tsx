import {
  ActionButton,
  Artifact,
  ArtifactActionProvider,
  BarChart,
  Callout,
  CodeBlock,
  Collapsible,
  DonutChart,
  Gauge,
  Header,
  KeyValue,
  LineChart,
  List,
  Metrics,
  Progress,
  Section,
  ShareList,
  Steps,
  Tabs,
  Timeline,
} from '@cradle/artifact'
import type { Meta, StoryObj } from '@storybook/react-vite'

function ArtifactKitGallery() {
  return (
    <main className="min-h-screen bg-[var(--background)] p-4 text-[var(--foreground)]">
      <div className="relative mx-auto h-[860px] max-w-3xl overflow-hidden rounded-[var(--radius-2xl)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
        <ArtifactActionProvider value={{ runPrompt: () => true }}>
          <Artifact>
            <Header
              eyebrow="Artifact kit · Design System"
              meta={['Aug 15 – Aug 21', 'Updated 14:02']}
              title="Attention report"
              summary="Quiet typography, real visualizations, and semantic tokens — no decorative color."
            />
            <Metrics
              items={[
                { label: 'Open items', value: '24', delta: { direction: 'down', label: '3' }, caption: 'vs last week', sparkline: [12, 14, 11, 16, 18, 17, 24] },
                { label: 'High risk', value: '3', delta: { direction: 'flat', label: '0' }, caption: 'review first' },
                { label: 'Coverage', value: '92%', delta: { direction: 'up', label: '2.2pt' }, caption: 'vs last week', sparkline: [86, 87, 89, 88, 90, 91, 92] },
                { label: 'Runs', value: '137', delta: { direction: 'up', label: '8' }, caption: 'vs last week' },
              ]}
            />
            <Section title="Daily runs" description="Peak day highlighted; hover any bar for the exact count.">
              <BarChart
                items={[
                  { label: 'Mon', value: 12 },
                  { label: 'Tue', value: 18 },
                  { label: 'Wed', value: 14 },
                  { label: 'Thu', value: 24 },
                  { label: 'Fri', value: 20 },
                  { label: 'Sat', value: 9 },
                  { label: 'Sun', value: 7 },
                ]}
                height={140}
              />
            </Section>
            <Section title="Trend" description="Runs per day over the report window.">
              <LineChart
                points={[
                  { label: 'Mon', value: 12 },
                  { label: 'Tue', value: 18 },
                  { label: 'Wed', value: 14 },
                  { label: 'Thu', value: 24 },
                  { label: 'Fri', value: 20 },
                  { label: 'Sat', value: 9 },
                  { label: 'Sun', value: 7 },
                ]}
                height={140}
              />
            </Section>
            <Section title="Distribution" description="Share of attention by area.">
              <DonutChart
                segments={[
                  { label: 'Runtime', value: 8 },
                  { label: 'Browser', value: 5 },
                  { label: 'Design system', value: 3 },
                  { label: 'CLI', value: 2 },
                ]}
                size={132}
              />
            </Section>
            <Section title="Share by scope">
              <ShareList
                items={[
                  { label: 'Workspace', value: 8 },
                  { label: 'Session', value: 5 },
                  { label: 'Global', value: 3 },
                  { label: 'Agent', value: 2 },
                ]}
              />
            </Section>
            <Section title="Goals">
              <div className="flex flex-wrap items-center gap-8">
                <Gauge value={92} max={100} caption="Coverage" size={116} />
                <div className="flex min-w-[220px] flex-1 flex-col gap-3">
                  <Progress label="Sprint points" value={34} max={40} />
                  <Progress label="Review queue" value={7} max={24} />
                </div>
              </div>
            </Section>
            <Section title="Pipeline">
              <Steps
                steps={[
                  { label: 'Lint', status: 'done' },
                  { label: 'Typecheck', status: 'done' },
                  { label: 'Tests', status: 'current' },
                  { label: 'Build', status: 'upcoming' },
                ]}
              />
            </Section>
            <Section title="Recent events">
              <Timeline
                items={[
                  { title: 'Deploy to staging', description: 'build 4218 promoted', meta: '14:02', tone: 'success' },
                  { title: 'Flaky test quarantined', description: 'e2e/settings.spec.ts', meta: '13:41', tone: 'warning' },
                  { title: 'Rate limit hit', description: 'openai/gpt-5 throttled for 20m', meta: '11:20', tone: 'danger' },
                ]}
              />
            </Section>
            <Section title="Views">
              <Tabs
                tabs={[
                  {
                    id: 'clusters',
                    label: 'Clusters',
                    content: (
                      <List
                        items={[
                          { title: 'Runtime boundary', description: 'Needs a second pass', meta: '3 open', tone: 'warning' },
                          { title: 'Browser surface', description: 'Stable in latest build', meta: '8 done', tone: 'success' },
                        ]}
                      />
                    ),
                  },
                  {
                    id: 'details',
                    label: 'Details',
                    content: (
                      <KeyValue
                        items={[
                          { label: 'Window', value: 'Aug 15 – Aug 21' },
                          { label: 'Sessions analyzed', value: '137' },
                        ]}
                      />
                    ),
                  },
                  {
                    id: 'snippet',
                    label: 'Snippet',
                    content: (
                      <CodeBlock
                        title="artifact.config.ts"
                        language="ts"
                        code={'export const config = {\n  maxWidth: 760,\n  theme: "adaptive",\n}'}
                      />
                    ),
                  },
                ]}
              />
            </Section>
            <Collapsible title="Methodology" className="w-full">
              <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                Token counts include system prompts and tool outputs. Cache hits are counted at the discounted rate.
              </p>
            </Collapsible>
            <Callout title="Review window" tone="info">
              Three changes need a human decision before the next run.
            </Callout>
            <div className="flex items-center justify-end gap-2">
              <ActionButton prompt="Summarize this report in three bullets." variant="ghost">
                Summarize
              </ActionButton>
              <ActionButton prompt="Explain the highest-risk cluster." variant="primary">
                Explain the risk
              </ActionButton>
            </div>
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
