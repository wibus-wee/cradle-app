const PALETTE = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-fuchsia-500',
  'bg-indigo-500',
  'bg-lime-500',
]

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function flowColor(flowId: string | null | undefined): string | null {
  if (!flowId) {
    return null
  }
  return PALETTE[hash(flowId) % PALETTE.length]
}
