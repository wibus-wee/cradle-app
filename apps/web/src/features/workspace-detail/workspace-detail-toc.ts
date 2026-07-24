import type {
  WorkspaceDetailTocHeading,
  WorkspaceDetailTocLayout,
} from './workspace-detail-types'

const HEADING_RE = /^(#{1,6})\s+(\S.*)$/gm
const RE_NON_WORD = /[^\w\u4E00-\u9FFF]+/g
const RE_BOUNDARY_DASH = /(^-|-$)/g
const RE_FENCED_CODE = /```[\s\S]*?```/g
const ACTIVE_HEADING_TOP_OFFSET = 80
const HEADING_SELECTOR = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'
const TOC_PROXIMITY_FADE_RATIO = 0.72

export const WORKSPACE_DETAIL_TOC_ITEM_HEIGHT = 22
export const EMPTY_WORKSPACE_DETAIL_TOC_LAYOUT: WorkspaceDetailTocLayout = {
  height: 0,
  activeSlug: null,
  items: [],
}

function slugifyWorkspaceDetailHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(RE_NON_WORD, '-')
    .replace(RE_BOUNDARY_DASH, '')
}

export function parseWorkspaceDetailHeadings(
  markdown: string | null,
  file: string,
): WorkspaceDetailTocHeading[] {
  if (!markdown) {
    return []
  }

  const result: WorkspaceDetailTocHeading[] = []
  const stripped = markdown.replace(RE_FENCED_CODE, '')

  HEADING_RE.lastIndex = 0
  let match: RegExpExecArray | null = HEADING_RE.exec(stripped)
  while (match !== null) {
    const text = match[2]!.trim()
    result.push({
      level: match[1]!.length,
      text,
      slug: slugifyWorkspaceDetailHeading(text),
      file,
    })
    match = HEADING_RE.exec(stripped)
  }

  return result
}

export function buildWorkspaceDetailTocLayout(
  container: HTMLElement,
  headings: WorkspaceDetailTocHeading[],
): WorkspaceDetailTocLayout {
  const headingElements = Array
    .from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .filter(element => element.offsetParent !== null)

  if (headingElements.length === 0 || headings.length === 0) {
    return EMPTY_WORKSPACE_DETAIL_TOC_LAYOUT
  }

  const visibleCount = Math.min(headingElements.length, headings.length)
  const containerTop = container.getBoundingClientRect().top
  const activeScrollTop = container.scrollTop + ACTIVE_HEADING_TOP_OFFSET
  const fadeDistance = Math.max(
    container.clientHeight * TOC_PROXIMITY_FADE_RATIO,
    1,
  )
  let activeSlug = headingElements[0]?.id ?? null

  const items = headingElements.slice(0, visibleCount).map((element, index) => {
    const heading = headings[index]!
    const headingTop = element.getBoundingClientRect().top
      - containerTop
      + container.scrollTop
    const headingBottom = headingTop + element.offsetHeight
    const visible = headingBottom >= container.scrollTop
      && headingTop <= container.scrollTop + container.clientHeight
    const intensity = 1 - Math.min(
      1,
      Math.abs(headingTop - activeScrollTop) / fadeDistance,
    )

    if (headingTop <= activeScrollTop) {
      activeSlug = element.id
    }

    return {
      ...heading,
      top: index * WORKSPACE_DETAIL_TOC_ITEM_HEIGHT,
      height: WORKSPACE_DETAIL_TOC_ITEM_HEIGHT,
      visible,
      intensity,
    }
  })

  return {
    height: visibleCount * WORKSPACE_DETAIL_TOC_ITEM_HEIGHT,
    activeSlug,
    items,
  }
}
