import type { FileContents, MultiFileDiffProps } from '@pierre/diffs/react'
import { MultiFileDiff } from '@pierre/diffs/react'
import { useMemo } from 'react'

import { cn } from '~/lib/cn'

import { DIFF_THEME } from './diff-constants'
import { diffContentCacheKey } from './diff-data'
import type { DiffStyle } from './diff-options'

type DiffOptions = NonNullable<MultiFileDiffProps<undefined>['options']>

interface FileContentsDiffViewProps {
  filePath: string
  oldContent: string
  newContent: string
  diffStyle: DiffStyle
  className?: string
  showFileHeader?: boolean
}

export function FileContentsDiffView({
  filePath,
  oldContent,
  newContent,
  diffStyle,
  className,
  showFileHeader = false,
}: FileContentsDiffViewProps) {
  const oldFile = useMemo<FileContents>(() => ({
    name: filePath,
    contents: oldContent,
    cacheKey: diffContentCacheKey('old', filePath, oldContent),
  }), [filePath, oldContent])
  const newFile = useMemo<FileContents>(() => ({
    name: filePath,
    contents: newContent,
    cacheKey: diffContentCacheKey('new', filePath, newContent),
  }), [filePath, newContent])
  const options = useMemo<DiffOptions>(() => ({
    theme: DIFF_THEME,
    themeType: 'system',
    diffStyle,
    disableFileHeader: !showFileHeader,
    disableBackground: false,
    diffIndicators: 'bars',
    hunkSeparators: 'line-info-basic',
    lineDiffType: 'word',
    overflow: 'scroll',
    parseDiffOptions: { context: 3 },
  }), [diffStyle, showFileHeader])

  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={options}
      className={cn(
        'max-h-128 overflow-auto [--diffs-font-size:11px] [--diffs-line-height:18px]',
        className,
      )}
    />
  )
}
