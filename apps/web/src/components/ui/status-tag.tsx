/**
 * @description Animated status tag with SVG progress indicators and smooth state transitions
 * @input Status value, color, and optional label
 * @output Animated SVG icon + dropdown selector
 * @position components/ui — reusable UI primitive
 */
import { useState } from 'react'
import { m } from 'motion/react'

import { cn } from '~/lib/cn'

import { Popover, PopoverContent, PopoverTrigger } from './popover'

interface StatusOption {
  id: number
  label: string
  value: string
  color: string
  bg: string
  fill: number
}

const defaultStatuses: StatusOption[] = [
  { id: 1, label: 'Draft', value: 'draft', color: '#354055', bg: '#F3F4F7', fill: 0 },
  { id: 2, label: 'In-progress', value: 'in-progress', color: '#F07C29', bg: '#FFEED7', fill: 0.5 },
  { id: 3, label: 'In-review', value: 'in-review', color: '#195FEF', bg: '#EFF4FF', fill: 0.75 },
  { id: 4, label: 'Completed', value: 'completed', color: '#099557', bg: '#EBFDF3', fill: 1 },
]

/** Kanban-style status categories with their canonical colors. */
const kanbanCategoryColors: Record<string, string> = {
  triage: '#a855f7',
  backlog: '#6b7280',
  unstarted: '#9ca3af',
  started: '#f59e0b',
  completed: '#22c55e',
  canceled: '#6b7280',
}

const kanbanCategoryBgs: Record<string, string> = {
  triage: '#f5f0ff',
  backlog: '#f3f4f6',
  unstarted: '#f3f4f6',
  started: '#fffbeb',
  completed: '#f0fdf4',
  canceled: '#f3f4f6',
}

const CIRCUMFERENCE = 2 * Math.PI * 2

const KANBAN_CATEGORIES = new Set(Object.keys(kanbanCategoryColors))

/**
 * Animated SVG status icon.
 * - Draft: dashed ring
 * - In-progress / In-review: stroke-dashoffset fill arc
 * - Completed: solid circle + animated checkmark draw
 * - Kanban categories (triage/backlog/unstarted/started/completed/canceled): static SVG
 */
function StatusIcon({ value, color, size = 12, animated = true, className }: {
  value: string
  color: string
  size?: number
  animated?: boolean
  className?: string
}) {
  const isKanban = KANBAN_CATEGORIES.has(value)

  // Kanban category rendering (static, no motion)
  if (isKanban) {
    const cx = 8
    const cy = 8
    const r = 6

    if (value === 'triage') {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={2} />
        </svg>
      )
    }
    if (value === 'backlog') {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />
        </svg>
      )
    }
    if (value === 'unstarted') {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      )
    }
    if (value === 'started') {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`} fill={color} />
        </svg>
      )
    }
    if (value === 'completed') {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
          <circle cx={cx} cy={cy} r={r} fill={color} />
        </svg>
      )
    }
    if (value === 'canceled') {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <line x1={cx - r + 2} y1={cy} x2={cx + r - 2} y2={cy} stroke={color} strokeWidth={1.5} />
        </svg>
      )
    }
  }

  // Original animated rendering for generic statuses
  const statuses = defaultStatuses
  const fill = statuses.find((s) => s.value === value)?.fill ?? 0
  const isDraft = value === 'draft'
  const isCompleted = value === 'completed'

  if (!animated) {
    // Static fallback for non-animated mode
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
        {isDraft && (
          <circle cx={8} cy={8} r={6} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2.5 2.5" />
        )}
        {!isDraft && !isCompleted && (
          <>
            <circle cx={8} cy={8} r={6} fill="none" stroke={color} strokeWidth={1.5} />
            <circle cx={8} cy={8} r={2} fill="none" stroke={color} strokeWidth={4}
              strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - fill)}
              transform="rotate(-90 8 8)" />
          </>
        )}
        {isCompleted && (
          <circle cx={8} cy={8} r={6.75} fill={color} />
        )}
      </svg>
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)}>
      {/* Dashed ring — draft only */}
      <m.circle
        cx={8}
        cy={8}
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="2.5 2.5"
        animate={{ opacity: isDraft ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />

      {/* Thin ring — hidden when draft or completed */}
      <m.circle
        cx={8}
        cy={8}
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        animate={{ opacity: isDraft || isCompleted ? 0 : 1 }}
        transition={{ duration: 0.3 }}
      />

      {/* Progress arc — strokeDashoffset animation */}
      <m.circle
        cx={8}
        cy={8}
        r={2}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={CIRCUMFERENCE}
        transform="rotate(-90 8 8)"
        animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - fill) }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
      />

      {/* Filled circle — completed only */}
      <m.circle
        cx={8}
        cy={8}
        r={6.75}
        stroke="none"
        fill={color}
        animate={{ opacity: isCompleted ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />

      {/* Checkmark path — draws on with delay */}
      <m.path
        d="M 5 8.2 L 7.2 10.5 L 11 5.5"
        stroke="white"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        animate={{
          pathLength: isCompleted ? 1 : 0,
          opacity: isCompleted ? 1 : 0,
        }}
        transition={
          isCompleted
            ? {
                pathLength: { duration: 0.3, delay: 0.5, ease: 'easeOut' },
                opacity: { duration: 0.15, delay: 0.5 },
              }
            : { pathLength: { duration: 0 }, opacity: { duration: 0.1 } }
        }
      />
    </svg>
  )
}

/**
 * Animated status tag dropdown.
 * Renders a compact tag button that opens a popover to switch status.
 */
function StatusTagDropdown({ statuses = defaultStatuses, className }: {
  statuses?: StatusOption[]
  className?: string
}) {
  const [selected, setSelected] = useState(statuses[0])

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger
          render={(
            <button
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer outline-none"
              style={{ backgroundColor: selected.bg }}
            >
              <StatusIcon value={selected.value} color={selected.color} />
            </button>
          )}
        />
        <PopoverContent align="start">
          {statuses.map((status) => (
            <button
              key={status.value}
              className={cn(
                'flex items-center gap-2 w-full cursor-pointer rounded-sm px-2 py-1.5',
                'text-sm outline-none hover:bg-accent',
              )}
              onClick={() => setSelected(status)}
            >
              <StatusIcon value={status.value} color={status.color} />
              <span className="text-xs font-medium" style={{ color: status.color }}>
                {status.label}
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <span className="text-sm font-sans font-medium">Design homepage wireframe</span>
    </div>
  )
}

export { StatusIcon, StatusTagDropdown, defaultStatuses, kanbanCategoryColors, kanbanCategoryBgs }
export type { StatusOption }
