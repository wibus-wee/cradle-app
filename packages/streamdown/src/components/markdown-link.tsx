import type { AnchorHTMLAttributes, MouseEvent } from 'react'

type CradleElectronBridge = {
  env?: {
    isElectron?: boolean
  }
  ipc?: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
}

type CradleWindow = Window & {
  cradle?: CradleElectronBridge
}

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export type MarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>

export function isExternalMarkdownHref(href: string | undefined): href is string {
  return resolveExternalMarkdownHref(href) !== null
}

export function resolveExternalMarkdownHref(href: string | undefined): string | null {
  if (!href) {
    return null
  }

  const trimmed = href.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('//')) {
    const currentProtocol = typeof window === 'undefined' ? 'https:' : window.location.protocol
    const protocol = currentProtocol === 'http:' || currentProtocol === 'https:'
      ? currentProtocol
      : 'https:'
    return `${protocol}${trimmed}`
  }

  try {
    const parsed = new URL(trimmed)
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null
  }
  catch {
    return null
  }
}

export function handleExternalMarkdownLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
): void {
  const externalHref = resolveExternalMarkdownHref(href)
  if (!externalHref || event.defaultPrevented || typeof window === 'undefined') {
    return
  }

  const bridge = (window as CradleWindow).cradle
  if (!bridge?.env?.isElectron || !bridge.ipc) {
    return
  }

  event.preventDefault()
  void bridge.ipc.invoke('native.openExternal', externalHref).catch(() => {
    window.open(externalHref, '_blank', 'noopener,noreferrer')
  })
}

export function MarkdownLink({
  href,
  onClick,
  rel,
  target,
  children,
  ...props
}: MarkdownLinkProps) {
  const externalHref = resolveExternalMarkdownHref(href)

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    handleExternalMarkdownLinkClick(event, href)
  }

  return (
    <a
      href={href}
      target={target ?? (externalHref ? '_blank' : undefined)}
      rel={rel ?? (externalHref ? 'noreferrer noopener' : undefined)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </a>
  )
}
