import {
  Button,
  Chart,
  ContentUnavailableView,
  Form,
  Host,
  HStack,
  Image,
  LabeledContent,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  monospacedDigit,
  pickerStyle,
  refreshable,
  tag,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'

import type { UsageRange } from './usage-range'
import { usageRanges } from './usage-range'
import type { UsageViewProps } from './usage-view-contract'
import { denseRecentUsageDays, formatUsageNumber } from './usage-view-model'

export type { UsageViewProps } from './usage-view-contract'

const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const tabularNumber = monospacedDigit()

export function UsageView({
  daily,
  onRangeChange,
  onRefresh,
  range,
  stats,
  summary,
}: UsageViewProps) {
  const [showAllModels, setShowAllModels] = useState(false)
  const recentDays = denseRecentUsageDays(daily)
  const models = showAllModels ? summary.byModel : summary.byModel.slice(0, 5)
  const maxModelTokens = Math.max(...summary.byModel.map(model => model.totalTokens), 1)
  const maxProviderTokens = Math.max(
    ...summary.byProviderTarget.map(provider => provider.totalTokens),
    1,
  )
  const formModifiers = [
    listStyle('insetGrouped'),
    ...(onRefresh ? [refreshable(async () => { await onRefresh() })] : []),
  ]

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={formModifiers}>
        <Section>
          <Picker<UsageRange>
            modifiers={[pickerStyle('segmented')]}
            onSelectionChange={onRangeChange}
            selection={range}
          >
            {usageRanges.map(option => (
              <Text key={option.key} modifiers={[tag(option.key)]}>{option.label}</Text>
            ))}
          </Picker>
        </Section>

        <Section
          footer={(
            <Text modifiers={[secondaryForeground]}>
              {`${formatUsageNumber(summary.totalTurns)} turns in the selected range`}
            </Text>
          )}
          title="Token Usage"
        >
          <Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold' }), tabularNumber]}>
            {formatUsageNumber(summary.totalTokens)}
          </Text>
          <LabeledContent label="Input Tokens">
            <Text modifiers={[tabularNumber]}>{formatUsageNumber(summary.totalPromptTokens)}</Text>
          </LabeledContent>
          <LabeledContent label="Output Tokens">
            <Text modifiers={[tabularNumber]}>{formatUsageNumber(summary.totalCompletionTokens)}</Text>
          </LabeledContent>
        </Section>

        <Section title="Last 14 Days">
          <Chart
            animate={false}
            barStyle={{ cornerRadius: 3 }}
            data={recentDays.map(day => ({ x: day.date.slice(5), y: day.totalTokens }))}
            modifiers={[frame({ height: 150, maxWidth: Infinity })]}
            showGrid
            type="bar"
          />
        </Section>

        <Section title="Activity">
          <LabeledContent label="Today">
            <Text modifiers={[tabularNumber]}>{formatUsageNumber(stats.todayTokens)}</Text>
          </LabeledContent>
          <LabeledContent label="Daily Average">
            <Text modifiers={[tabularNumber]}>{formatUsageNumber(stats.avgDailyTokens)}</Text>
          </LabeledContent>
          <LabeledContent label="Active Days">
            <Text modifiers={[tabularNumber]}>{stats.activeDays.toString()}</Text>
          </LabeledContent>
          <LabeledContent label="Current Streak">
            <Text modifiers={[tabularNumber]}>{`${stats.currentStreak} days`}</Text>
          </LabeledContent>
        </Section>

        <Section title="Models">
          {models.map(model => (
            <VStack alignment="leading" key={model.modelId} spacing={7}>
              <HStack modifiers={[fullWidth]} spacing={12}>
                <Text>{model.modelId}</Text>
                <Spacer />
                <Text modifiers={[secondaryForeground, tabularNumber]}>
                  {formatUsageNumber(model.totalTokens)}
                </Text>
              </HStack>
              <ProgressView value={model.totalTokens / maxModelTokens} />
            </VStack>
          ))}
          {summary.byModel.length === 0 && (
            <ContentUnavailableView
              description="Model usage appears after a runtime reports token counts."
              systemImage="cpu"
              title="No Model Usage"
            />
          )}
          {summary.byModel.length > 5 && (
            <Button
              modifiers={[buttonStyle('plain')]}
              onPress={() => setShowAllModels(current => !current)}
            >
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image
                  color="blue"
                  size={15}
                  systemName={showAllModels ? 'chevron.up' : 'chevron.down'}
                />
                <Text modifiers={[foregroundStyle('blue')]}>
                  {showAllModels ? 'Show Top 5' : `Show All ${summary.byModel.length}`}
                </Text>
                <Spacer />
              </HStack>
            </Button>
          )}
        </Section>

        {summary.byProviderTarget.length > 0 && (
          <Section title="Providers">
            {summary.byProviderTarget.map(provider => (
              <VStack alignment="leading" key={provider.providerTargetId} spacing={7}>
                <HStack modifiers={[fullWidth]} spacing={12}>
                  <Text>{provider.providerTargetName ?? provider.providerTargetId}</Text>
                  <Spacer />
                  <Text modifiers={[secondaryForeground, tabularNumber]}>
                    {formatUsageNumber(provider.totalTokens)}
                  </Text>
                </HStack>
                <ProgressView value={provider.totalTokens / maxProviderTokens} />
              </VStack>
            ))}
          </Section>
        )}
      </Form>
    </Host>
  )
}
