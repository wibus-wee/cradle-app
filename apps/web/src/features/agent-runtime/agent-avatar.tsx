import { RobotLine as BotIcon } from '@mingcute/react'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { cn } from '~/lib/cn'

import { buildAvatarUrl } from './avatar-url'

export interface AgentAvatarProps {
  name?: string | null
  avatarUrl?: string | null
  avatarStyle?: string | null
  avatarSeed?: string | null
  size?: number
  className?: string
}

function avatarImageUrl(avatarUrl?: string | null, avatarStyle?: string | null, avatarSeed?: string | null): string | null {
  if (avatarUrl) {
    return avatarUrl
  }
  if (avatarStyle && avatarSeed) {
    return buildAvatarUrl(avatarStyle, avatarSeed)
  }
  return null
}

export function AgentAvatar({
  name,
  avatarUrl,
  avatarStyle,
  avatarSeed,
  size = 20,
  className,
}: AgentAvatarProps) {
  const imageUrl = avatarImageUrl(avatarUrl, avatarStyle, avatarSeed)
  const lobeIconSlug = avatarStyle === 'lobehub-icon' ? avatarSeed : null
  const initial = name?.trim().charAt(0)?.toUpperCase()

  return (
    <Avatar
      size="sm"
      className={cn(
        'overflow-hidden rounded-full bg-muted',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {lobeIconSlug
        ? (
            <div className="flex size-full items-center justify-center p-1">
              <ProviderIcon iconSlug={lobeIconSlug} presetId={null} className="size-full" />
            </div>
          )
        : imageUrl && (
            <img
              src={imageUrl}
              alt={name ?? ''}
              className="size-full rounded-full object-cover"
              crossOrigin="anonymous"
            />
          )}
      {!lobeIconSlug && !imageUrl && (
        <AvatarFallback className="text-[10px] font-medium">
          {initial ?? <BotIcon className="size-3" aria-hidden="true" />}
        </AvatarFallback>
      )}
    </Avatar>
  )
}
