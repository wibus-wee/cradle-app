import type { CodeViewOptions } from '@pierre/diffs'

import { DIFF_LINE_HEIGHT, DIFF_THEME } from './diff-constants'

export type DiffStyle = 'split' | 'unified'

interface DiffInteractionOptions<TAnnotation> {
  controlledSelection?: boolean
  enableGutterUtility?: boolean
  enableLineSelection?: boolean
  onGutterUtilityClick?: CodeViewOptions<TAnnotation>['onGutterUtilityClick']
}

export function buildDiffOptions<TAnnotation = undefined>(
  diffStyle: DiffStyle,
  interaction: DiffInteractionOptions<TAnnotation> = {},
): CodeViewOptions<TAnnotation> {
  return {
    theme: DIFF_THEME,
    themeType: 'system',
    diffStyle,
    diffIndicators: 'bars',
    overflow: 'scroll',
    lineDiffType: 'word',
    hunkSeparators: 'line-info-basic',
    enableLineSelection: interaction.enableLineSelection,
    controlledSelection: interaction.controlledSelection,
    enableGutterUtility: interaction.enableGutterUtility,
    onGutterUtilityClick: interaction.onGutterUtilityClick,
    stickyHeaders: true,
    pointerEventsOnScroll: false,
    itemMetrics: {
      hunkLineCount: 1,
      lineHeight: DIFF_LINE_HEIGHT,
    },
  }
}
