const RE_WHITESPACE = /\s+/
const RE_GITHUB_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/
const RE_GITHUB_NOREPLY_OLD = /^([^@]+)@users\.noreply\.github\.com$/

function nameHue(name: string): number {
  let hash = 0
  for (let index = 0; index < name.length; index++) {
    hash = ((hash * 31) + name.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

function emailToAvatarUrl(email: string, gravatarHash: string): string | null {
  const newer = RE_GITHUB_NOREPLY.exec(email)
  if (newer) {
    return `https://avatars.githubusercontent.com/u/${newer[1]}?v=4&s=32`
  }
  const older = RE_GITHUB_NOREPLY_OLD.exec(email)
  if (older) {
    return `https://github.com/${older[1]}.png?size=32`
  }
  if (gravatarHash) {
    return `https://www.gravatar.com/avatar/${gravatarHash}?s=32&d=identicon`
  }
  return null
}

export interface GitAuthorAvatarViewProps {
  name: string
  email: string
  gravatarHash: string
}

export function GitAuthorAvatarView({
  name,
  email,
  gravatarHash,
}: GitAuthorAvatarViewProps) {
  const words = name.trim().split(RE_WHITESPACE).filter(Boolean)
  const initials = words.length >= 2
    ? (words[0]![0] ?? '') + (words.at(-1)![0] ?? '')
    : (words[0]?.[0] ?? name[0] ?? '?')
  const hue = nameHue(name || email)
  const avatarUrl = emailToAvatarUrl(email, gravatarHash)

  return (
    <span
      className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold leading-none text-white"
      style={{ background: `hsl(${hue}, 45%, 48%)` }}
      aria-label={name || email}
    >
      <span aria-hidden="true">{initials.toUpperCase()}</span>
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 size-full rounded-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      )}
    </span>
  )
}
