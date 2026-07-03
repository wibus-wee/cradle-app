import type { MouseEvent, RefObject } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

interface ItemRect {
  top: number
  left: number
  width: number
  height: number
}

export function useProximityHover(containerRef: RefObject<HTMLElement | null>) {
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map())
  const sessionRef = useRef(0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [itemRects, setItemRects] = useState<ItemRect[]>([])

  const measureItems = useCallback(() => {
    const next: ItemRect[] = []
    elementsRef.current.forEach((element, index) => {
      next[index] = {
        top: element.offsetTop,
        left: element.offsetLeft,
        width: element.offsetWidth,
        height: element.offsetHeight,
      }
    })
    setItemRects(next)
  }, [])

  const registerItem = useCallback((index: number, element: HTMLElement | null) => {
    if (element) {
      elementsRef.current.set(index, element)
    }
 else {
      elementsRef.current.delete(index)
    }
    measureItems()
  }, [measureItems])

  const readPointerIndex = useCallback((event: MouseEvent<HTMLElement>): number | null => {
    const container = containerRef.current
    if (!container) {
      return null
    }
    const containerRect = container.getBoundingClientRect()
    const layoutHeight = container.offsetHeight
    const visualHeight = containerRect.height
    const scale = layoutHeight > 0 ? visualHeight / layoutHeight : 1
    const pointerX = (event.clientX - containerRect.left) / scale + container.scrollLeft
    const pointerY = (event.clientY - containerRect.top) / scale + container.scrollTop

    let nearestIndex: number | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    elementsRef.current.forEach((element, index) => {
      const top = element.offsetTop
      const left = element.offsetLeft
      const width = element.offsetWidth
      const height = element.offsetHeight
      const insideX = pointerX >= left && pointerX <= left + width
      const insideY = pointerY >= top && pointerY <= top + height
      if (insideX && insideY) {
        nearestIndex = index
        nearestDistance = 0
        return
      }

      const centerX = left + width / 2
      const centerY = top + height / 2
      const distance = Math.hypot(pointerX - centerX, pointerY - centerY)
      if (distance < nearestDistance) {
        nearestIndex = index
        nearestDistance = distance
      }
    })

    return nearestIndex
  }, [containerRef])

  const handlers = useMemo(() => ({
    onMouseEnter: () => {
      sessionRef.current += 1
      measureItems()
    },
    onMouseMove: (event: MouseEvent<HTMLElement>) => {
      setActiveIndex(readPointerIndex(event))
    },
    onMouseLeave: () => {
      setActiveIndex(null)
    },
  }), [measureItems, readPointerIndex])

  return {
    activeIndex,
    setActiveIndex,
    itemRects,
    sessionRef,
    handlers,
    registerItem,
    measureItems,
  }
}
