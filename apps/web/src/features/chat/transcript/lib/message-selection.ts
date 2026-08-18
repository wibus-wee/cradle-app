export interface MessageSelection {
  messageId: string
  selectedText: string
  rect: DOMRect
  /** Rect of the selected line at the focus end (where the pointer was released). */
  focusRect: DOMRect
}

function readElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement
}

/** Reads a non-empty selection that stays inside one rendered message. */
export function readMessageSelection(
  root: HTMLElement,
  selection: Selection | null,
): MessageSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const startElement = readElement(range.startContainer)
  const endElement = readElement(range.endContainer)
  const startContent = startElement?.closest<HTMLElement>('[data-message-content]')
  const endContent = endElement?.closest<HTMLElement>('[data-message-content]')

  if (
    !startContent
    || startContent !== endContent
    || !root.contains(startContent)
  ) {
    return null
  }

  const message = startContent.closest<HTMLElement>('[data-message-id]')
  const messageId = message?.dataset.messageId
  const selectedText = selection.toString().replace(/\r\n?/g, '\n').trim()

  if (!messageId || selectedText.length === 0) {
    return null
  }

  const rects = range.getClientRects()
  let backwards = false
  if (selection.anchorNode && selection.focusNode) {
    backwards = selection.anchorNode === selection.focusNode
      ? selection.anchorOffset > selection.focusOffset
      : Boolean(
          selection.anchorNode.compareDocumentPosition(selection.focusNode)
          & Node.DOCUMENT_POSITION_PRECEDING,
        )
  }
  const lineRects = [...rects]
  const focusRect = (backwards ? lineRects[0] : lineRects.at(-1))
    ?? range.getBoundingClientRect()

  return {
    messageId,
    selectedText,
    rect: range.getBoundingClientRect(),
    focusRect,
  }
}

export function formatSelectionAsQuote(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) {
    return ''
  }

  return `${normalized.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
}
