import { source } from './source'

export interface DocsGraphNode {
  id: string
  url: string
  text: string
  description?: string
  section: string
  inboundCount: number
  outboundCount: number
  neighbors?: string[]
}

export interface DocsGraphLink {
  source: string
  target: string
}

export interface DocsGraphUnresolvedReference {
  sourceTitle: string
  sourceUrl: string
  href: string
}

export interface DocsGraphPageScore {
  title: string
  url: string
  section: string
  inboundCount: number
  outboundCount: number
}

export interface DocsGraph {
  nodes: DocsGraphNode[]
  links: DocsGraphLink[]
  stats: {
    pageCount: number
    rawReferenceCount: number
    internalLinkCount: number
    externalReferenceCount: number
    unresolvedReferenceCount: number
  }
  topLinkedPages: DocsGraphPageScore[]
  weakPages: DocsGraphPageScore[]
  unresolvedReferences: DocsGraphUnresolvedReference[]
}

type DocsPage = (typeof source)['$inferPage']

function stripHash(href: string) {
  return href.split('#', 1)[0]
}

function pageDirectory(pagePath: string) {
  const lastSlash = pagePath.lastIndexOf('/')

  if (lastSlash < 0) {
    return ''
  }

  return pagePath.slice(0, lastSlash)
}

function sectionKey(page: DocsPage) {
  return page.slugs[0] ?? 'home'
}

function isPageReference(href: string) {
  const target = stripHash(href)

  return (
    target.startsWith('./')
    || target.startsWith('../')
    || target.startsWith('/docs')
    || target.endsWith('.md')
    || target.endsWith('.mdx')
  )
}

function resolveReference(page: DocsPage, href: string) {
  const resolved = source.getPageByHref(href, {
    dir: pageDirectory(page.path),
    language: page.locale,
  })

  if (resolved) {
    return resolved.page
  }

  const normalizedHref = stripHash(source.resolveHref(href, page))

  if (!normalizedHref.startsWith('/docs')) {
    return undefined
  }

  return source.getPages(page.locale).find(candidate => candidate.url === normalizedHref)
}

function sortBySignal(left: DocsGraphPageScore, right: DocsGraphPageScore) {
  const inboundDelta = right.inboundCount - left.inboundCount

  if (inboundDelta !== 0) {
    return inboundDelta
  }

  const outboundDelta = right.outboundCount - left.outboundCount

  if (outboundDelta !== 0) {
    return outboundDelta
  }

  return left.title.localeCompare(right.title)
}

export function buildDocsGraph(): DocsGraph {
  const pages = source.getPages()
  const nodeIndex = new Map<string, DocsGraphNode>()
  const linkIndex = new Set<string>()
  const links: DocsGraphLink[] = []
  const unresolvedReferences: DocsGraphUnresolvedReference[] = []
  let rawReferenceCount = 0
  let externalReferenceCount = 0

  for (const page of pages) {
    nodeIndex.set(page.url, {
      id: page.url,
      url: page.url,
      text: page.data.title,
      description: page.data.description,
      section: sectionKey(page),
      inboundCount: 0,
      outboundCount: 0,
    })
  }

  for (const page of pages) {
    const references = page.data.extractedReferences ?? []
    const sourceNode = nodeIndex.get(page.url)

    if (!sourceNode) {
      continue
    }

    for (const reference of references) {
      rawReferenceCount += 1

      if (!isPageReference(reference.href)) {
        externalReferenceCount += 1
        continue
      }

      const targetPage = resolveReference(page, reference.href)

      if (!targetPage) {
        unresolvedReferences.push({
          sourceTitle: page.data.title,
          sourceUrl: page.url,
          href: reference.href,
        })
        continue
      }

      if (targetPage.url === page.url) {
        continue
      }

      const key = `${page.url}->${targetPage.url}`

      if (linkIndex.has(key)) {
        continue
      }

      linkIndex.add(key)
      links.push({
        source: page.url,
        target: targetPage.url,
      })
    }
  }

  for (const link of links) {
    const sourceNode = nodeIndex.get(link.source)
    const targetNode = nodeIndex.get(link.target)

    if (sourceNode) {
      sourceNode.outboundCount += 1
    }

    if (targetNode) {
      targetNode.inboundCount += 1
    }
  }

  const nodes = Array.from(nodeIndex.values()).sort((left, right) => left.url.localeCompare(right.url))
  const scores = nodes.map(node => ({
    title: node.text,
    url: node.url,
    section: node.section,
    inboundCount: node.inboundCount,
    outboundCount: node.outboundCount,
  }))

  return {
    nodes,
    links,
    stats: {
      pageCount: nodes.length,
      rawReferenceCount,
      internalLinkCount: links.length,
      externalReferenceCount,
      unresolvedReferenceCount: unresolvedReferences.length,
    },
    topLinkedPages: scores
      .filter(score => score.inboundCount > 0)
      .sort(sortBySignal)
      .slice(0, 8),
    weakPages: scores
      .filter(score => score.url !== '/docs')
      .filter(score => score.inboundCount === 0 || score.outboundCount === 0)
      .sort((left, right) => {
        const totalLeft = left.inboundCount + left.outboundCount
        const totalRight = right.inboundCount + right.outboundCount

        if (totalLeft !== totalRight) {
          return totalLeft - totalRight
        }

        return left.url.localeCompare(right.url)
      })
      .slice(0, 8),
    unresolvedReferences: unresolvedReferences.slice(0, 8),
  }
}
