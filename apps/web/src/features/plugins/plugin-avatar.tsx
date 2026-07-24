import { useState } from 'react'

interface PluginAvatarProps {
  iconUrl: string | null
  name: string
}

export function PluginAvatar({ iconUrl, name }: PluginAvatarProps) {
  const [failed, setFailed] = useState(false)

  if (iconUrl && !failed) {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-card">
        <img
          src={iconUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  const initial = name.trim().charAt(0).toUpperCase() || '?'

  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-[12px] font-semibold text-foreground/80 select-none"
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}
