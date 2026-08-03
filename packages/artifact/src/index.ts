/**
 * @cradle/artifact — constrained JSX kit for Cradle Agent Artifacts.
 *
 * Agent source MUST import only from `cradle/artifact` (and optionally `react`).
 * The host remaps `cradle/artifact` → this package at compile time.
 */

import { ActionButton } from './components/action-button'
import { Artifact } from './components/artifact'
import { BarChart } from './components/bar-chart'
import { Callout } from './components/callout'
import { Header } from './components/header'
import { List } from './components/list'
import { MetricCell, MetricGrid } from './components/metric-grid'
import { Section } from './components/section'
import { SegmentedBar } from './components/segmented-bar'
import { Divider, HStack, Stack, Text } from './components/stack'
import { Table } from './components/table'

export type { ArtifactActionContextValue } from './action-context'
export { ARTIFACT_THEME_STYLE } from './theme'
export { ArtifactActionProvider, useArtifactAction } from './action-context'
export type { ActionButtonProps } from './components/action-button'
export { ActionButton } from './components/action-button'
export type { ArtifactProps } from './components/artifact'
export { Artifact } from './components/artifact'
export type { BarChartItem, BarChartProps } from './components/bar-chart'
export { BarChart } from './components/bar-chart'
export type { CalloutProps } from './components/callout'
export { Callout } from './components/callout'
export type { HeaderProps } from './components/header'
export { Header } from './components/header'
export type { ListItem, ListProps } from './components/list'
export { List } from './components/list'
export type { MetricGridProps, MetricItem } from './components/metric-grid'
export { MetricCell, MetricGrid } from './components/metric-grid'
export type { SectionProps } from './components/section'
export { Section } from './components/section'
export type { SegmentedBarProps, SegmentedBarSegment, Tone } from './components/segmented-bar'
export { SegmentedBar } from './components/segmented-bar'
export type { DividerProps, HStackProps, StackProps, TextProps } from './components/stack'
export { Divider, HStack, Stack, Text } from './components/stack'
export type { TableColumn, TableProps } from './components/table'
export { Table } from './components/table'

/** Runtime module map used by the Artifact host compiler. */
export function createArtifactModuleExports() {
  return {
    Artifact,
    Header,
    MetricGrid,
    MetricCell,
    Section,
    SegmentedBar,
    Table,
    List,
    Callout,
    BarChart,
    ActionButton,
    Stack,
    HStack,
    Text,
    Divider,
  }
}
