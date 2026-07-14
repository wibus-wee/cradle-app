import { handleExternalMarkdownLinkClick, isExternalMarkdownHref } from '@cradle/streamdown'
import type { AnchorHTMLAttributes } from 'react'

import { useBrowserPanelStore } from '~/store/browser-panel'

import { useSessionBinding } from '../session/use-session-binding'

interface MarkdownFileLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string
  sessionId?: string | null
}

/**
 * Custom link component for Streamdown that intercepts file path clicks
 * and opens them in the browser panel.
 */
export function MarkdownFileLink({ href, sessionId, children, ...props }: MarkdownFileLinkProps) {
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const sessionBinding = useSessionBinding(sessionId ?? null, Boolean(sessionId))
  const workspaceId = sessionBinding?.workspaceId ?? null

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event)
    if (event.defaultPrevented) {
      return
    }

    if (!href || !workspaceId) {
      handleExternalMarkdownLinkClick(event, href)
      return
    }

    // Parse file path from various link formats
    const filePath = parseFilePathFromHref(href)

    if (filePath) {
      event.preventDefault()
      openWorkspaceFileTab({
        workspaceId,
        path: filePath,
        view: getDefaultViewForPath(filePath),
      })
      return
    }

    handleExternalMarkdownLinkClick(event, href)
  }

  const external = isExternalMarkdownHref(href)

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

/**
 * Parse file path from various href formats:
 * - file:///absolute/path/to/file.ts
 * - /absolute/path/to/file.ts
 * - relative/path/to/file.ts
 * - src/file.ts:123 (with line number)
 */
function parseFilePathFromHref(href: string): string | null {
  if (!href) {
    return null
  }

  // Handle file:// protocol
  if (href.startsWith('file://')) {
    const path = href.replace(/^file:\/\//, '')
    return stripLineNumber(path)
  }

  // Handle absolute paths starting with /
  if (href.startsWith('/')) {
    return stripLineNumber(href)
  }

  // Check if it looks like a file path (has file extension or contains /)
  const hasFileExtension = /\.[a-z0-9]+(?::\d+)?$/i.test(href)
  const hasPathSeparator = href.includes('/')

  if (hasFileExtension || hasPathSeparator) {
    // Don't intercept http/https URLs
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return null
    }
    return stripLineNumber(href)
  }

  return null
}

/**
 * Strip line number from file path (e.g., "file.ts:123" -> "file.ts")
 */
function stripLineNumber(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, '')
}

/**
 * Get default view mode based on file extension
 */
function getDefaultViewForPath(path: string): 'editor' | 'preview' {
  const lowerPath = path.toLowerCase()

  // Preview for markdown and read-only formats
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
    return 'preview'
  }

  // Preview for image files
  if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/.test(lowerPath)) {
    return 'preview'
  }

  // Preview for PDF and office files
  if (/\.(pdf|docx?|xlsx?|pptx?)$/.test(lowerPath)) {
    return 'preview'
  }

  // Default to editor for code files
  return 'editor'
}
