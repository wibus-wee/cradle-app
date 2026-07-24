import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '~/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip'

import type {
  CreateAutomationDraft,
  ScheduleDraft,
  ScheduleFrequency,
  Weekday,
} from './automation-draft'
import {
  buildScheduleRrule,
  clampScheduleNumber,
  DEFAULT_SCHEDULE,
  formatScheduleSummary,
  WEEKDAY_OPTIONS,
} from './automation-draft'
import { AutomationFormField } from './automation-form-field'

export interface AutomationScheduleBuilderViewProps {
  schedule: ScheduleDraft
  timezone: string
  misfirePolicy: CreateAutomationDraft['misfirePolicy']
  onScheduleChange: (schedule: ScheduleDraft) => void
  onTimezoneChange: (timezone: string) => void
  onMisfirePolicyChange: (
    policy: CreateAutomationDraft['misfirePolicy'],
  ) => void
}

function isScheduleFrequency(value: string): value is ScheduleFrequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly'
}

function isWeekday(value: string): value is Weekday {
  return value === 'MO'
    || value === 'TU'
    || value === 'WE'
    || value === 'TH'
    || value === 'FR'
    || value === 'SA'
    || value === 'SU'
}

export function AutomationScheduleBuilderView({
  schedule,
  timezone,
  misfirePolicy,
  onScheduleChange,
  onTimezoneChange,
  onMisfirePolicyChange,
}: AutomationScheduleBuilderViewProps) {
  const { t } = useTranslation('automation')
  const rrulePreview = buildScheduleRrule(schedule)

  const updateFrequency = useCallback((frequency: string) => {
    if (!isScheduleFrequency(frequency)) {
      return
    }
    onScheduleChange({
      ...schedule,
      frequency,
      weekdays: schedule.weekdays.length > 0
        ? schedule.weekdays
        : DEFAULT_SCHEDULE.weekdays,
    })
  }, [onScheduleChange, schedule])

  const updateWeekdays = useCallback((weekdays: string[]) => {
    const validWeekdays = weekdays.filter(isWeekday)
    onScheduleChange({
      ...schedule,
      weekdays: validWeekdays.length > 0
        ? validWeekdays
        : DEFAULT_SCHEDULE.weekdays,
    })
  }, [onScheduleChange, schedule])

  return (
    <TooltipProvider>
      <div className="grid gap-3">
        <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/15 p-3">
          <div className="grid gap-2">
            <Label className="text-[12px] text-foreground">
              {t('schedule.frequency.label')}
            </Label>
            <ToggleGroup
              type="single"
              value={schedule.frequency}
              onValueChange={updateFrequency}
              variant="outline"
              size="sm"
              className="w-full"
            >
              <ToggleGroupItem value="daily" className="min-w-0 flex-1">
                {t('schedule.frequency.daily')}
              </ToggleGroupItem>
              <ToggleGroupItem value="weekly" className="min-w-0 flex-1">
                {t('schedule.frequency.weekly')}
              </ToggleGroupItem>
              <ToggleGroupItem value="monthly" className="min-w-0 flex-1">
                {t('schedule.frequency.monthly')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <AutomationFormField
              label={t('schedule.interval.label')}
              description={t('schedule.interval.description')}
            >
              <NumberField
                size="sm"
                min={1}
                max={99}
                value={schedule.interval}
                onValueChange={value =>
                  onScheduleChange({
                    ...schedule,
                    interval: clampScheduleNumber(value ?? 1, 1, 99),
                  })}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput
                    aria-label={t('schedule.interval.aria')}
                  />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </AutomationFormField>

            <AutomationFormField
              label={t('schedule.time.label')}
              htmlFor="automation-schedule-time"
            >
              <Input
                id="automation-schedule-time"
                type="time"
                value={schedule.time}
                onChange={event =>
                  onScheduleChange({
                    ...schedule,
                    time: event.target.value || DEFAULT_SCHEDULE.time,
                  })}
                className="font-mono tabular-nums"
              />
            </AutomationFormField>

            <AutomationFormField label={t('schedule.timezone.label')}>
              <Input
                value={timezone}
                onChange={event => onTimezoneChange(event.target.value)}
                placeholder={t('schedule.timezone.placeholder')}
                className="font-mono text-[12px]"
              />
            </AutomationFormField>
          </div>

          {schedule.frequency === 'weekly' && (
            <div className="grid gap-2">
              <Label className="text-[12px] text-foreground">
                {t('schedule.weekdays.label')}
              </Label>
              <ToggleGroup
                type="multiple"
                value={schedule.weekdays}
                onValueChange={updateWeekdays}
                variant="outline"
                size="sm"
                className="flex w-full flex-wrap"
              >
                {WEEKDAY_OPTIONS.map(day => (
                  <ToggleGroupItem
                    key={day}
                    value={day}
                    className="min-w-10 flex-1"
                  >
                    {t(`schedule.weekdayShort.${day}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {schedule.frequency === 'monthly' && (
            <AutomationFormField
              label={t('schedule.monthDay.label')}
              description={t('schedule.monthDay.description')}
            >
              <NumberField
                size="sm"
                min={1}
                max={31}
                value={schedule.monthDay}
                onValueChange={value =>
                  onScheduleChange({
                    ...schedule,
                    monthDay: clampScheduleNumber(value ?? 1, 1, 31),
                  })}
              >
                <NumberFieldGroup className="max-w-40">
                  <NumberFieldDecrement />
                  <NumberFieldInput
                    aria-label={t('schedule.monthDay.aria')}
                  />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </AutomationFormField>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0 rounded-lg border border-border/50 bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">
              {t('schedule.summary.label')}
            </div>
            <div className="mt-1 text-sm text-foreground text-pretty">
              {formatScheduleSummary(schedule, t)}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <div className="mt-2 truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {rrulePreview}
                  </div>
                )}
              />
              <TooltipContent>
                {t('schedule.rrulePreview.tooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
          <AutomationFormField
            label={t('schedule.misfire.label')}
            description={t('schedule.misfire.description')}
          >
            <Select
              value={misfirePolicy}
              onValueChange={(value) => {
                if (value === 'skip' || value === 'run_latest') {
                  onMisfirePolicyChange(value)
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="run_latest">
                  {t('schedule.misfire.runLatest')}
                </SelectItem>
                <SelectItem value="skip">
                  {t('schedule.misfire.skip')}
                </SelectItem>
              </SelectContent>
            </Select>
          </AutomationFormField>
        </div>
      </div>
    </TooltipProvider>
  )
}
