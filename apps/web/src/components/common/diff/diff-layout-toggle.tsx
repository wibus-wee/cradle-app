import {
  Columns2Line as Columns2Icon,
  Rows3Line as Rows3Icon,
} from '@mingcute/react'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import type { DiffStyle } from './diff-options'

interface DiffLayoutToggleProps {
  value: DiffStyle
  onValueChange: (value: DiffStyle) => void
  disabled?: boolean
  className?: string
}

export function DiffLayoutToggle({
  value,
  onValueChange,
  disabled = false,
  className,
}: DiffLayoutToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === 'split' || nextValue === 'unified') {
          onValueChange(nextValue)
        }
      }}
      variant="outline"
      size="sm"
      className={cn('h-5 shrink-0 gap-px', className)}
      aria-label="Diff layout"
      disabled={disabled}
    >
      <ToggleGroupItem value="split" aria-label="Split" className="h-5 gap-1 px-1.5 text-[10px]">
        <Columns2Icon className="size-2.5" />
        Split
      </ToggleGroupItem>
      <ToggleGroupItem value="unified" aria-label="Unified" className="h-5 gap-1 px-1.5 text-[10px]">
        <Rows3Icon className="size-2.5" />
        Unified
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
