import { z } from 'zod'

import { kanbanCategoryColors, StatusIcon as UIStatusIcon } from '~/components/ui/status-tag'

import type { StatusCategory } from '../use-view-config'

export const StatusCategorySchema = z.union([
  z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']),
  z.null().transform(() => 'unstarted' as const),
  z.undefined().transform(() => 'unstarted' as const),
])

export function StatusIcon({ category, size = 16, className }: {
  category: StatusCategory | string | null | undefined
  size?: number
  className?: string
}) {
  const normalizedCategory = StatusCategorySchema.parse(category) as StatusCategory
  const color = kanbanCategoryColors[normalizedCategory] ?? '#9ca3af'
  return <UIStatusIcon value={normalizedCategory} color={color} size={size} animated={false} className={className} />
}
