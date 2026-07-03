import type { ComponentProps } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '~/lib/cn'
import { getLobeIconUrl } from '~/lib/lobe-icons'
import { useResolvedThemeMode } from '~/store/theme'

import hijarvisIconUrl from './assets/hijarvis.png'

type IconProps = ComponentProps<'svg'>
export type RuntimeIconDescriptor = { key: string } | { svg: string } | { url: string }

// ─── Brand icons (SVG paths sourced from @lobehub/icons-static-svg) ────────────
// Each icon uses its official brand color.

function ClaudeIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fillRule="evenodd" className={cn('size-4', className)} {...props}>
      <path fill="#D97757" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  )
}

function ClaudeCodeIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fillRule="evenodd" className={cn('size-4', className)} {...props}>
      <path fill="#D97757" clipRule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />
    </svg>
  )
}

function OpenAIIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fillRule="evenodd" className={cn('size-4', className)} {...props}>
      <path fill="currentColor" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
  )
}

function CodexIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fillRule="evenodd" className={cn('size-4', className)} {...props}>
      <path fill="currentColor" clipRule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" />
    </svg>
  )
}

function CustomIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn('size-4', className)} {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function HiJarvisIcon({ className }: IconProps) {
  return <img src={hijarvisIconUrl} alt="" className={cn('size-4 object-contain', className)} />
}

export const PROVIDER_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  'anthropic': ClaudeIcon,
  'claude': ClaudeIcon,
  'claude-agent': ClaudeIcon,
  'claude-cli': ClaudeCodeIcon,
  'codex': CodexIcon,
  'hijarvis': HiJarvisIcon,
  'openai': OpenAIIcon,
  'custom': CustomIcon,
  'universal': CustomIcon,
}

function renderPresetIcon(presetId: string | null | undefined, className?: string) {
  switch (presetId) {
    case 'anthropic':
    case 'claude-agent':
      return <ClaudeIcon className={className} />
    case 'claude-cli':
      return <ClaudeCodeIcon className={className} />
    case 'codex':
      return <CodexIcon className={className} />
    case 'hijarvis':
      return <HiJarvisIcon className={className} />
    case 'openai':
      return <OpenAIIcon className={className} />
    case 'custom':
    case 'universal':
      return <CustomIcon className={className} />
    default:
      return null
  }
}

// ── Unified provider icon component ──

/**
 * Renders explicit icon sources first and falls back to the provider preset
 * only when no custom icon slug is selected.
 */
export function ProviderIcon({
  iconSlug,
  iconUrl,
  presetId,
  className,
}: {
  iconSlug?: string | null
  iconUrl?: string | null
  presetId: string | null
  className?: string
}) {
  if (iconUrl) {
    return <img src={iconUrl} alt="" className={cn('object-contain', className)} />
  }
  if (iconSlug) {
    if (iconSlug.startsWith('url:')) {
      return <img src={decodeURIComponent(iconSlug.slice(4))} alt="" className={cn('object-contain', className)} />
    }
    const Icon = PROVIDER_ICONS[iconSlug]
    if (Icon) {
      return <Icon className={className} />
    }
    return <LobeIconImage slug={iconSlug} className={className} />
  }
  return renderPresetIcon(presetId, className) ?? <CustomIcon className={className} />
}

export function RuntimeIcon({
  icon,
  className,
}: {
  icon: RuntimeIconDescriptor | null | undefined
  className?: string
}) {
  if (!icon) {
    return <ProviderIcon iconSlug="custom" presetId={null} className={className} />
  }

  if ('url' in icon) {
    return <img src={icon.url} alt="" className={cn('object-contain', className)} />
  }

  if ('svg' in icon) {
    return (
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}`}
        alt=""
        className={cn('object-contain', className)}
      />
    )
  }

  return <ProviderIcon iconSlug={icon.key} presetId={null} className={className} />
}

function LobeIconImage({ slug, className }: { slug: string, className?: string }) {
  const theme = useResolvedThemeMode()
  const iconKey = `${slug}:${theme}`
  const [loadedIcon, setLoadedIcon] = useState<{ key: string, url: string } | null>(null)
  const url = loadedIcon?.key === iconKey ? loadedIcon.url : null

  useEffect(() => {
    let cancelled = false
    getLobeIconUrl(slug, theme).then((u) => {
      if (!cancelled && u) {
        setLoadedIcon({ key: iconKey, url: u })
      }
    })
    return () => {
      cancelled = true
    }
  }, [iconKey, slug, theme])

  if (!url) {
    return <div className={cn('animate-pulse rounded bg-muted', className)} />
  }

  return (
    <img
      src={url}
      alt={slug}
      className={cn('object-contain', className)}
    />
  )
}
