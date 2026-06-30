import type { ReactNode } from 'react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'

interface Citation {
  index: number
  title?: string
  url?: string
  snippet?: string
}

interface CitationPopoverProps {
  /** Container ref to scan for citations */
  containerRef: React.RefObject<HTMLElement | null>
  /** Citation data keyed by index */
  citations: Citation[]
  /** Custom render for popover content */
  renderPopover?: (citation: Citation) => ReactNode
}

const CITATION_PATTERN = /\[\d+\]/
const CITATION_CAPTURE = /\[(\d+)\]/g

/**
 * Post-render citation processing.
 * Scans rendered DOM for [N] patterns via TreeWalker,
 * wraps them in interactive spans with hover popovers.
 */
export function CitationPopover({ containerRef, citations, renderPopover }: CitationPopoverProps) {
  const [activeCitation, setActiveCitation] = useState<{ citation: Citation, rect: DOMRect } | null>(null)
  const processedRef = useRef(new WeakSet<Text>())

  useEffect(() => {
    const container = containerRef.current
    if (!container || citations.length === 0) {
      return
    }
    const listeners: Array<{
      span: HTMLSpanElement
      handleMouseEnter: () => void
      handleMouseLeave: () => void
    }> = []

    // TreeWalker to find text nodes with citation patterns
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!(node instanceof Text)) {
          return NodeFilter.FILTER_REJECT
        }
        if (processedRef.current.has(node)) {
          return NodeFilter.FILTER_REJECT
        }
        return CITATION_PATTERN.test(node.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })

    const textNodes: Text[] = []
    let current: Node | null = walker.nextNode()
    while (current != null) {
      textNodes.push(current as Text)
      current = walker.nextNode()
    }

    for (const textNode of textNodes) {
      processedRef.current.add(textNode)
      const text = textNode.textContent ?? ''
      const regex = new RegExp(CITATION_CAPTURE.source, CITATION_CAPTURE.flags)
      let match: RegExpExecArray | null = regex.exec(text)
      const parts: (string | { index: number })[] = []
      let lastIndex = 0

      while (match != null) {
        if (match.index > lastIndex) {
          parts.push(text.slice(lastIndex, match.index))
        }
        parts.push({ index: Number.parseInt(match[1], 10) })
        lastIndex = match.index + match[0].length
        match = regex.exec(text)
      }
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex))
      }

      if (parts.length <= 1) {
        continue
      }

      const fragment = document.createDocumentFragment()
      for (const part of parts) {
        if (typeof part === 'string') {
          fragment.appendChild(document.createTextNode(part))
        }
 else {
          const span = document.createElement('span')
          span.className = 'stream-citation'
          span.textContent = `[${part.index}]`
          span.dataset.citationIndex = String(part.index)
          span.style.cursor = 'pointer'
          span.style.color = 'var(--primary, #3b82f6)'
          span.style.textDecoration = 'underline'
          span.style.textDecorationStyle = 'dotted'
          const handleMouseEnter = () => {
            const citation = citations.find(c => c.index === part.index)
            if (citation) {
              setActiveCitation({ citation, rect: span.getBoundingClientRect() })
            }
          }
          const handleMouseLeave = () => setActiveCitation(null)
          span.addEventListener('mouseenter', handleMouseEnter)
          span.addEventListener('mouseleave', handleMouseLeave)
          listeners.push({ span, handleMouseEnter, handleMouseLeave })
          fragment.appendChild(span)
        }
      }
      textNode.parentNode?.replaceChild(fragment, textNode)
    }

    return () => {
      for (const listener of listeners) {
        listener.span.removeEventListener('mouseenter', listener.handleMouseEnter)
        listener.span.removeEventListener('mouseleave', listener.handleMouseLeave)
      }
    }
  }, [containerRef, citations])

  if (!activeCitation) {
    return null
  }

  const { citation, rect } = activeCitation
  return (
    <div
      style={{
        position: 'fixed',
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -100%)',
        padding: '8px 12px',
        background: 'var(--popover-bg, #1f2937)',
        color: 'var(--popover-fg, #f9fafb)',
        borderRadius: 6,
        fontSize: 12,
        maxWidth: 300,
        zIndex: 99999,
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      {renderPopover
? renderPopover(citation)
: (
        <>
          {citation.title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{citation.title}</div>}
          {citation.snippet && <div style={{ opacity: 0.8 }}>{citation.snippet}</div>}
          {citation.url && <div style={{ opacity: 0.6, marginTop: 4, fontSize: 10 }}>{citation.url}</div>}
        </>
      )}
    </div>
  )
}

export type { Citation, CitationPopoverProps }
