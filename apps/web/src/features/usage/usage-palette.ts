// Categorical color palette for ranked breakdowns (models / agents /
// providers / mock sessions). apps/web's own theme (see styles.css) only
// exposes a handful of semantic tokens (accent = neutral hover fill, not a
// brand color), so — matching the existing convention in
// features/chat/context/context-usage-detail-panel.tsx — categorical charts
// here use Tailwind's default color scale directly. Hex values are hardcoded
// (rather than `var(--color-blue-500)`) so they stay correct regardless of
// theme resolution and work directly as SVG `fill` values in recharts.
export const USAGE_CATEGORY_PALETTE = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#f97316', // orange-500
  '#10b981', // emerald-500
  '#f43f5e', // rose-500
  '#0ea5e9', // sky-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#6366f1', // indigo-500
  '#06b6d4', // cyan-500
] as const

export function categoryColor(index: number): string {
  return USAGE_CATEGORY_PALETTE[index % USAGE_CATEGORY_PALETTE.length]
}
