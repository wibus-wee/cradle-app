import * as React from 'react'

type LayoutRect = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

interface LayoutGeometryContextValue {
  centerColumnRect: LayoutRect | null
  footerRect: LayoutRect | null
  registerCenterColumn: (node: HTMLDivElement | null) => void
  registerFooter: (node: HTMLElement | null) => void
}

const LayoutGeometryContext = React.createContext<LayoutGeometryContextValue | null>(null)

function readTransformOffset(element: Element): { x: number, y: number } {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }

  const transform = window.getComputedStyle(element).transform
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') {
    return { x: 0, y: 0 }
  }

  try {
    const matrix = new DOMMatrixReadOnly(transform)
    return { x: matrix.m41, y: matrix.m42 }
  }
  catch {
    return { x: 0, y: 0 }
  }
}

function toLayoutRect(element: Element | null): LayoutRect | null {
  if (!element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  const width = element instanceof HTMLElement ? element.offsetWidth : rect.width
  const height = element instanceof HTMLElement ? element.offsetHeight : rect.height
  const transformOffset = readTransformOffset(element)
  const left = rect.left - (width - rect.width) / 2 - transformOffset.x
  const top = rect.top - (height - rect.height) / 2 - transformOffset.y

  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

export function LayoutGeometryProvider({ children }: { children: React.ReactNode }) {
  const [centerColumnElement, setCenterColumnElement] = React.useState<HTMLDivElement | null>(null)
  const [footerElement, setFooterElement] = React.useState<HTMLElement | null>(null)
  const [centerColumnRect, setCenterColumnRect] = React.useState<LayoutRect | null>(null)
  const [footerRect, setFooterRect] = React.useState<LayoutRect | null>(null)

  const rafIdRef = React.useRef(0)
  const scheduleMeasureRef = React.useRef<() => void>(() => {})

  const measure = () => {
    setCenterColumnRect(toLayoutRect(centerColumnElement))
    setFooterRect(toLayoutRect(footerElement))
  }

  const scheduleMeasure = () => {
    if (rafIdRef.current !== 0) {
      return
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0
      measure()
    })
  }

  React.useEffect(() => {
    scheduleMeasureRef.current = scheduleMeasure
  })

  React.useEffect(() => {
    const handleMeasure = () => scheduleMeasureRef.current()

    handleMeasure()
    const observer = new ResizeObserver(handleMeasure)
    if (centerColumnElement) {
      observer.observe(centerColumnElement)
    }
    if (footerElement) {
      observer.observe(footerElement)
    }

    window.addEventListener('resize', handleMeasure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleMeasure)
      if (rafIdRef.current !== 0) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
    }
  }, [centerColumnElement, footerElement])

  const value = ({
      centerColumnRect,
      footerRect,
      registerCenterColumn: setCenterColumnElement,
      registerFooter: setFooterElement,
    })

  return <LayoutGeometryContext.Provider value={value}>{children}</LayoutGeometryContext.Provider>
}

export function useLayoutGeometry(): LayoutGeometryContextValue {
  const value = React.useContext(LayoutGeometryContext)
  if (!value) {
    throw new Error('useLayoutGeometry must be used within LayoutGeometryProvider')
  }
  return value
}
