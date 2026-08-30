import { SegmentedControl } from '@expo/ui/community/segmented-control'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type {
  GetUsageDailyResponse,
  GetUsageStatsResponse,
  GetUsageSummaryResponse,
} from '@/api-gen'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { EmptyState } from '@/components/ui/states'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { UsageRange } from './usage-range'
import { usageRanges } from './usage-range'

type DailyUsage = GetUsageDailyResponse[number]

export interface UsageViewProps {
  daily: GetUsageDailyResponse
  isRefreshing?: boolean
  onRangeChange: (range: UsageRange) => void
  onRefresh?: () => void
  range: UsageRange
  stats: GetUsageStatsResponse
  summary: GetUsageSummaryResponse
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function denseRecentDays(daily: GetUsageDailyResponse, length = 14): DailyUsage[] {
  const byDate = new Map(daily.map(day => [day.date, day]))
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Array.from({ length }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (length - index - 1))
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
    return byDate.get(key) ?? {
      completionTokens: 0,
      count: 0,
      date: key,
      promptTokens: 0,
      totalTokens: 0,
    }
  })
}

export function UsageView({
  daily,
  isRefreshing = false,
  onRangeChange,
  onRefresh,
  range,
  stats,
  summary,
}: UsageViewProps) {
  const theme = useTheme()
  const [showAllModels, setShowAllModels] = useState(false)
  const recentDays = denseRecentDays(daily)
  const maxDailyTokens = Math.max(...recentDays.map(day => day.totalTokens), 1)
  const maxModelTokens = Math.max(...summary.byModel.map(model => model.totalTokens), 1)
  const models = showAllModels ? summary.byModel : summary.byModel.slice(0, 5)
  const selectedIndex = usageRanges.findIndex(option => option.key === range)

  return (
    <Screen
      insetTop={false}
      onRefresh={onRefresh}
      refreshing={isRefreshing}
    >
      <View style={styles.page}>
        <SegmentedControl
          appearance={theme.isDark ? 'dark' : 'light'}
          onValueChange={(value) => {
            const next = usageRanges.find(option => option.label === value)
            if (next) { onRangeChange(next.key) }
          }}
          selectedIndex={Math.max(selectedIndex, 0)}
          style={styles.segmented}
          values={usageRanges.map(option => option.label)}
        />

        <View style={[styles.hero, { borderBottomColor: theme.border }]}>
          <Text style={[styles.eyebrow, { color: theme.mutedForeground }]}>Token usage</Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={[styles.heroValue, { color: theme.foreground }]}
          >
            {formatNumber(summary.totalTokens)}
          </Text>
          <Text style={[styles.heroMeta, { color: theme.mutedForeground }]}>
            {`${formatNumber(summary.totalTurns)} turns in the selected range`}
          </Text>
        </View>

        <View style={[styles.tokenBreakdown, { borderBottomColor: theme.border }]}>
          <View style={styles.tokenType}>
            <Text style={[styles.tokenTypeValue, { color: theme.foreground }]}>
              {formatNumber(summary.totalPromptTokens)}
            </Text>
            <Text style={[styles.tokenTypeLabel, { color: theme.mutedForeground }]}>
              Input tokens
            </Text>
          </View>
          <View style={styles.tokenType}>
            <Text style={[styles.tokenTypeValue, { color: theme.foreground }]}>
              {formatNumber(summary.totalCompletionTokens)}
            </Text>
            <Text style={[styles.tokenTypeLabel, { color: theme.mutedForeground }]}>
              Output tokens
            </Text>
          </View>
        </View>

        <View style={[styles.stats, { borderBottomColor: theme.border }]}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.foreground }]}>
              {formatNumber(stats.todayTokens)}
            </Text>
            <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Today</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.foreground }]}>
              {formatNumber(stats.avgDailyTokens)}
            </Text>
            <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Daily average</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.foreground }]}>{stats.activeDays}</Text>
            <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Active days</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.foreground }]}>
              {`${stats.currentStreak}d`}
            </Text>
            <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Current streak</Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading meta="Last 14 days" title="Activity" />
          <View style={styles.chart}>
            {recentDays.map(day => (
              <View key={day.date} style={styles.barSlot}>
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor: day.totalTokens > 0 ? theme.foreground : theme.muted,
                      height: Math.max(4, Math.round(day.totalTokens / maxDailyTokens * 88)),
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          <View style={styles.chartLabels}>
            <Text style={[styles.chartLabel, { color: theme.mutedForeground }]}>
              {recentDays[0]?.date.slice(5)}
            </Text>
            <Text style={[styles.chartLabel, { color: theme.mutedForeground }]}>Today</Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading meta={`${summary.byModel.length}`} title="Models" />
          {models.length === 0
            ? (
                <EmptyState
                  description="Model usage will appear after a runtime reports token counts."
                  title="No model usage"
                />
              )
            : models.map(model => (
                <View key={model.modelId} style={styles.modelRow}>
                  <View style={styles.modelMeta}>
                    <Text numberOfLines={1} style={[styles.modelName, { color: theme.foreground }]}>
                      {model.modelId}
                    </Text>
                    <Text style={[styles.modelValue, { color: theme.mutedForeground }]}>
                      {formatNumber(model.totalTokens)}
                    </Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: theme.muted }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          backgroundColor: theme.foreground,
                          width: `${Math.max(3, model.totalTokens / maxModelTokens * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
          {summary.byModel.length > 5 && (
            <Button
              icon={showAllModels ? ChevronUp : ChevronDown}
              label={showAllModels ? 'Show top 5' : `Show all ${summary.byModel.length}`}
              onPress={() => setShowAllModels(current => !current)}
              style={styles.modelToggle}
              variant="secondary"
            />
          )}
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: 2,
    minHeight: 4,
    width: '100%',
  },
  barSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    maxWidth: 20,
  },
  chart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
    height: 96,
    justifyContent: 'space-between',
  },
  chartLabel: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 17,
  },
  fill: {
    borderRadius: 2,
    height: 4,
  },
  hero: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.lg,
  },
  heroMeta: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  heroValue: {
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    lineHeight: 34,
  },
  modelMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  modelName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  modelRow: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  modelValue: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  modelToggle: {
    marginTop: spacing.sm,
  },
  page: {
    paddingTop: spacing.sm,
  },
  section: {
    marginTop: spacing.lg,
  },
  segmented: {
    marginBottom: spacing.lg,
    minHeight: 36,
  },
  stat: {
    flex: 1,
    gap: 2,
    minWidth: '50%',
    paddingVertical: spacing.sm,
  },
  statLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  statValue: {
    fontSize: 17,
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
  },
  stats: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingVertical: spacing.sm,
  },
  track: {
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  tokenBreakdown: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  tokenType: {
    flex: 1,
    gap: spacing.xs,
  },
  tokenTypeLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  tokenTypeValue: {
    fontSize: 17,
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
  },
})
