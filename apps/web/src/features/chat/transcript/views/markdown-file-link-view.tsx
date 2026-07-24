import { isExternalMarkdownHref } from '@cradle/streamdown'
import type { AnchorHTMLAttributes, MouseEvent } from 'react'

export interface MarkdownFileLinkViewProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string | undefined) => void
}

/** Props-only Markdown anchor. Host navigation is supplied by the runtime adapter. */
export function MarkdownFileLinkView({
  href,
  children,
  onNavigate,
  ...props
}: MarkdownFileLinkViewProps) {
  const external = isExternalMarkdownHref(href)

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event)
    if (!event.defaultPrevented) {
      onNavigate?.(event, href)
    }
  }

  return (
    <a
      {...props}
      href={href}
      target={props.target ?? (external ? '_blank' : undefined)}
      rel={props.rel ?? (external ? 'noreferrer noopener' : undefined)}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
