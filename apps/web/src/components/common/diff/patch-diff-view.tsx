import type { CodeViewHandle } from '@pierre/diffs/react'
import { CodeView, useStableCallback } from '@pierre/diffs/react'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'

import { cn } from '~/lib/cn'

import type { DiffData } from './diff-data'
import type { DiffStyle } from './diff-options'
import { buildDiffOptions } from './diff-options'

export interface PatchDiffViewHandle {
  scrollToPath: (path: string) => boolean
}

interface PatchDiffViewProps {
  data: DiffData
  diffStyle: DiffStyle
  className?: string
  enableLineSelection?: boolean
}

export const PatchDiffView = forwardRef<PatchDiffViewHandle, PatchDiffViewProps>(
  ({ data, diffStyle, className, enableLineSelection = false }, ref) => {
    const viewerRef = useRef<CodeViewHandle<undefined>>(null)
    const options = useMemo(
      () => buildDiffOptions(diffStyle, { enableLineSelection }),
      [diffStyle, enableLineSelection],
    )

    const scrollToPath = useStableCallback((path: string): boolean => {
      const viewer = viewerRef.current
      const itemId = data.pathToItemId.get(path)
      if (!viewer || !itemId) {
        return false
      }
      const item = viewer.getItem(itemId)
      if (item?.collapsed === true) {
        viewer.updateItem({
          ...item,
          collapsed: false,
          version: typeof item.version === 'number' ? item.version + 1 : 1,
        })
      }
      viewer.scrollTo({ type: 'item', id: itemId, align: 'start', behavior: 'smooth' })
      return true
    })

    useImperativeHandle(ref, () => ({ scrollToPath }), [scrollToPath])

    return (
      <CodeView
        ref={viewerRef}
        items={data.items}
        options={options}
        className={cn(
          'min-h-0 overflow-auto overscroll-contain [overflow-anchor:none]',
          '[--diffs-font-size:11px] [--diffs-line-height:18px]',
          className,
        )}
      />
    )
  },
)
