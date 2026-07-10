import { cn } from '~/lib/cn'
import type { ThemeProfile } from '~/store/theme-customization'
import { resolveThemePreview } from '~/store/theme-customization'

interface ThemePreviewProps {
  profile: ThemeProfile
  className?: string
}

export const ThemePreview = ({ profile, className }: ThemePreviewProps) => {
  const theme = resolveThemePreview(profile)
  const mutedForeground = `color-mix(in srgb, ${theme.foregroundColor} ${52 + Math.round(theme.contrast * 0.28)}%, ${theme.backgroundColor})`
  const surface = `color-mix(in srgb, ${theme.backgroundColor}, ${theme.foregroundColor} 5%)`
  const sidebar = theme.translucentSidebar
    ? `color-mix(in srgb, ${theme.backgroundColor} 72%, transparent)`
    : surface

  return (
    <div
      className={cn('flex h-full min-h-24 w-full overflow-hidden rounded-lg', className)}
      style={{
        backgroundColor: theme.backgroundColor,
        color: theme.foregroundColor,
        fontFamily: theme.uiFont,
      }}
    >
      <div
        className={cn(
          'flex w-[34%] flex-col gap-2 p-2.5',
          theme.translucentSidebar && 'backdrop-blur-lg',
        )}
        style={{ background: sidebar }}
      >
        <div className="flex gap-1">
          <span className="size-1.5 rounded-full bg-red-400" />
          <span className="size-1.5 rounded-full bg-amber-400" />
          <span className="size-1.5 rounded-full bg-emerald-400" />
        </div>
        <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
        <span className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: mutedForeground }} />
        <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: mutedForeground }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <span className="text-[9px] font-semibold leading-none">Cradle</span>
        <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: mutedForeground }} />
        <span className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: mutedForeground }} />
        <div
          className="mt-auto rounded-md px-2 py-1 text-[8px]"
          style={{ backgroundColor: surface, fontFamily: theme.codeFont }}
        >
          <span style={{ color: theme.accentColor }}>&gt;</span>
{' '}
cradle run
        </div>
      </div>
    </div>
  )
}

export const SystemThemePreview = ({
  light,
  dark,
}: {
  light: ThemeProfile
  dark: ThemeProfile
}) => (
  <div className="grid h-full w-full grid-cols-2 overflow-hidden rounded-lg">
    <ThemePreview profile={light} className="min-h-0 rounded-none" />
    <ThemePreview profile={dark} className="min-h-0 rounded-none" />
  </div>
)
