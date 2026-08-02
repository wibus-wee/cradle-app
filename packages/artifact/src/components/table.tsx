import type { ReactNode } from 'react'

import { cn } from '../cn'

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

export function Table<T extends Record<string, unknown> = Record<string, unknown>>({
  columns,
  rows,
  className,
  emptyMessage = 'No rows',
}: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className={cn('rounded-md border border-border/70 px-3 py-4 text-[12px] text-text-tertiary', className)}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className={cn('overflow-x-auto rounded-md border border-border/70', className)}>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40">
            {columns.map(column => (
              <th
                key={column.key}
                className={cn(
                  'px-3 py-2 font-medium text-text-secondary',
                  column.align === 'right' && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => {
            const rowKey = columns.map(column => String(row[column.key] ?? '')).join('|') || JSON.stringify(row)
            return (
              <tr key={rowKey} className="hover:bg-muted/30">
                {columns.map(column => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-2 tabular-nums text-foreground',
                      column.align === 'right' && 'text-right',
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
    return <span className="text-text-dim">—</span>
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
