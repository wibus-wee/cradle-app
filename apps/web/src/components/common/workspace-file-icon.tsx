/**
 * Shared workspace file icon rendering backed by the @pierre/trees icon resolver.
 */
/* eslint-disable react-dom/no-dangerously-set-innerhtml -- Trees exposes a package-owned SVG sprite sheet. */
import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from '@pierre/trees'

import { cn } from '~/lib/cn'

const WORKSPACE_FILE_ICON_RESOLVER = createFileTreeIconResolver({ set: 'complete', colored: true })
const WORKSPACE_FILE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet('complete')

interface WorkspaceFileIconProps {
  path: string
  className?: string
}

export function WorkspaceFileIconSpriteSheet() {
  return (
    <span
      className="pointer-events-none absolute size-0 overflow-hidden"
      dangerouslySetInnerHTML={{ __html: WORKSPACE_FILE_ICON_SPRITE_SHEET }}
    />
  )
}

export function WorkspaceFileIcon({ path, className }: WorkspaceFileIconProps) {
  const icon = WORKSPACE_FILE_ICON_RESOLVER.resolveIcon('file-tree-icon-file', path)
  const color = icon.token ? getBuiltInFileIconColor(icon.token) : undefined

  return (
    <svg
      className={cn('size-4 shrink-0 text-muted-foreground', className)}
      viewBox={icon.viewBox ?? '0 0 16 16'}
      width={icon.width ?? 16}
      height={icon.height ?? 16}
      style={color ? { color } : undefined}
      aria-hidden
    >
      <use href={`#${icon.name}`} />
    </svg>
  )
}
