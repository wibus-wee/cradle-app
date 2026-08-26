import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { cn } from '~/lib/cn'

export interface RepoOwnerAvatarProps {
  owner: string
  /** Owner avatar image URL; `null` falls back to the owner's initial. */
  avatarUrl?: string | null
  className?: string
}

/**
 * Git host owner avatar (e.g. GitHub organization/user) with an initial
 * fallback when the image is missing or fails to load.
 */
export function RepoOwnerAvatar({ owner, avatarUrl, className }: RepoOwnerAvatarProps) {
  return (
    <Avatar className={cn('size-4', className)} aria-label={owner}>
      {avatarUrl
        ? <AvatarImage src={avatarUrl} alt="" loading="lazy" />
        : null}
      <AvatarFallback className="text-[9px] font-semibold">
        {(owner[0] ?? '?').toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
