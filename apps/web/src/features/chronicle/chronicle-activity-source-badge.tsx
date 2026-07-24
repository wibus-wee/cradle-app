import { Badge } from '~/components/ui/badge'

export interface ChronicleActivitySourceBadgeProps {
  label: string
  value: number
}

export function ChronicleActivitySourceBadge({
  label,
  value,
}: ChronicleActivitySourceBadgeProps) {
  if (value <= 0) {
    return null
  }

  return (
    <Badge variant="secondary" className="text-[11px]">
      {label}
      {' '}
      {value}
    </Badge>
  )
}
