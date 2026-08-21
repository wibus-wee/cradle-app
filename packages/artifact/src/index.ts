/**
 * @cradle/artifact — constrained JSX kit for Cradle Agent Artifacts.
 *
 * Agent source MUST import only from `cradle/artifact` (and optionally `react`).
 * The host remaps `cradle/artifact` → this package at compile time.
 */

import { ActionButton } from './components/action-button'
import { Artifact } from './components/artifact'
import { Badge } from './components/badge'
import { BarChart } from './components/bar-chart'
import { Callout } from './components/callout'
import { CodeBlock } from './components/code-block'
import { Collapsible } from './components/collapsible'
import { DeltaBadge } from './components/delta-badge'
import { DonutChart } from './components/donut-chart'
import { EmptyState } from './components/empty-state'
import { Gauge } from './components/gauge'
import { Header } from './components/header'
import { KeyValue } from './components/key-value'
import { LegacyMetricCell, LegacyMetricGrid, LegacySegmentedBar } from './components/legacy'
import { LineChart } from './components/line-chart'
import { List } from './components/list'
import { Metrics } from './components/metrics'
import { Progress } from './components/progress'
import { Section } from './components/section'
import { ShareList } from './components/share-list'
import { Sparkline } from './components/sparkline'
import { Divider, HStack, Stack, Text } from './components/stack'
import { Steps } from './components/steps'
import { Table } from './components/table'
import { Tabs } from './components/tabs'
import { Timeline } from './components/timeline'

export type { ArtifactActionContextValue } from './action-context'
export { ArtifactActionProvider, useArtifactAction } from './action-context'
export type { ActionButtonProps } from './components/action-button'
export { ActionButton } from './components/action-button'
export type { ArtifactProps } from './components/artifact'
export { Artifact } from './components/artifact'
export type { BadgeProps } from './components/badge'
export { Badge } from './components/badge'
export type { BarChartItem, BarChartProps } from './components/bar-chart'
export { BarChart } from './components/bar-chart'
export type { CalloutProps } from './components/callout'
export { Callout } from './components/callout'
export type { CodeBlockProps } from './components/code-block'
export { CodeBlock } from './components/code-block'
export type { CollapsibleProps } from './components/collapsible'
export { Collapsible } from './components/collapsible'
export type { DeltaBadgeProps } from './components/delta-badge'
export { DeltaBadge } from './components/delta-badge'
export type { DonutChartProps, DonutSegment } from './components/donut-chart'
export { DonutChart } from './components/donut-chart'
export type { EmptyStateProps } from './components/empty-state'
export { EmptyState } from './components/empty-state'
export type { GaugeProps } from './components/gauge'
export { Gauge } from './components/gauge'
export type { HeaderProps } from './components/header'
export { Header } from './components/header'
export type { KeyValueItem, KeyValueProps } from './components/key-value'
export { KeyValue } from './components/key-value'
export type { LineChartPoint, LineChartProps } from './components/line-chart'
export { LineChart } from './components/line-chart'
export type { ListItem, ListProps } from './components/list'
export { List } from './components/list'
export type { MetricItem, MetricsProps } from './components/metrics'
export { Metrics } from './components/metrics'
export type { ProgressProps } from './components/progress'
export { Progress } from './components/progress'
export type { SectionProps } from './components/section'
export { Section } from './components/section'
export type { ShareItem, ShareListProps } from './components/share-list'
export { ShareList } from './components/share-list'
export type { SparklineProps } from './components/sparkline'
export { Sparkline } from './components/sparkline'
export type { DividerProps, HStackProps, StackProps, TextProps } from './components/stack'
export { Divider, HStack, Stack, Text } from './components/stack'
export type { StepItem, StepsProps } from './components/steps'
export { Steps } from './components/steps'
export type { TableColumn, TableProps } from './components/table'
export { Table } from './components/table'
export type { TabItem, TabsProps } from './components/tabs'
export { Tabs } from './components/tabs'
export type { TimelineItem, TimelineProps } from './components/timeline'
export { Timeline } from './components/timeline'
export { ARTIFACT_THEME_STYLE, CHART_COLORS, chartColor } from './theme'

/** Runtime module map used by the Artifact host compiler. */
export function createArtifactModuleExports() {
  return {
    Artifact,
    Header,
    Section,
    Metrics,
    DeltaBadge,
    Sparkline,
    BarChart,
    LineChart,
    DonutChart,
    Gauge,
    ShareList,
    Progress,
    Table,
    List,
    Timeline,
    Steps,
    Callout,
    Badge,
    KeyValue,
    CodeBlock,
    Collapsible,
    Tabs,
    EmptyState,
    ActionButton,
    Stack,
    HStack,
    Text,
    Divider,

    // Pre-redesign names, kept for persisted Artifact sources (see legacy.tsx).
    MetricGrid: LegacyMetricGrid,
    MetricCell: LegacyMetricCell,
    SegmentedBar: LegacySegmentedBar,
  }
}
