import type { ReactNode } from 'react'

import { cn } from '../cn'
import { EmptyState } from './empty-state'

export interface TableColumn<T extends Record<string, unknown> = Record<string, unknown>> {
  key: keyof T & string
  header: string
  align?: 'left' | 'right'
  render?: (row: T) => ReactNode
}

export interface TableProps<T extends Record<string, unknown> = Record<string, unknown>> {
  columns: Array<TableColumn<T>>
  rows: T[]
  className?: string
  emptyMessage?: string
}

/** Hairline-ringed well, airy rows, mono numerics for right-aligned columns. */
export function Table<T extends Record<string, unknown> = Record<string, unknown>>({
  columns,
  rows,
  className,
  emptyMessage = 'No rows',
}: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'overflow-hidden rounded-[var(--radius-lg)] shadow-[inset_0_0_0_1px_var(--border)]',
          className,
        )}
      >
        <EmptyState message={emptyMessage} className="py-6" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-[var(--radius-lg)] shadow-[inset_0_0_0_1px_var(--border)]',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {columns.map(column => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3.5 py-2.5 text-[11px] font-medium text-[var(--muted-foreground)]',
                  column.align === 'right' && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowKey = columns.map(column => String(row[column.key] ?? '')).join('|') || JSON.stringify(row)
            return (
              <tr
                key={rowKey}
                className="border-b border-[var(--border)] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)] last:border-b-0 hover:bg-[var(--muted)]"
              >
                {columns.map(column => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3.5 py-2.5 text-[var(--foreground)]',
                      column.align === 'right' && 'text-right font-mono tabular-nums text-[var(--muted-foreground)]',
                    )}
                  >
                    {column.render
                      ? column.render(row)
                      : formatCell(row[column.key])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function formatCell(value: unknown): ReactNode {
  if (value == null) {
    return <span className="text-[var(--text-dim)]">—</span>
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (typeof value === 'number') {
    return value.toLocaleString('en-US')
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}
