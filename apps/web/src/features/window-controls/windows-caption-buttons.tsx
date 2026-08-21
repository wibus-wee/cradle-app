import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isElectron, nativeIpc, platform } from '~/lib/electron'

import type { CaptionButtonId, CaptionButtonRect } from './windows-caption-buttons-view'
import { WindowsCaptionButtonsView } from './windows-caption-buttons-view'

const CAPTION_BUTTON_IDS: CaptionButtonId[] = ['minimize', 'maximize', 'close']

function isCaptionButtonId(value: string): value is CaptionButtonId {
  return (CAPTION_BUTTON_IDS as string[]).includes(value)
}

export function WindowsCaptionButtons() {
  const { t } = useTranslation('chrome')
  const [maximized, setMaximized] = useState(false)
  const [hoveredButton, setHoveredButton] = useState<CaptionButtonId | null>(null)
  const [pressedButton, setPressedButton] = useState<CaptionButtonId | null>(null)
  const rectsRef = useRef<CaptionButtonRect[]>([])

  useEffect(() => {
    if (!isElectron || platform !== 'win32') {
      return
    }
    nativeIpc?.window.isMaximized()
      .then(setMaximized)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isElectron || platform !== 'win32') {
      return
    }
    const unsubscribeMaximized = window.cradle?.window.onMaximizedChanged?.((value) => {
      setMaximized(Boolean(value))
    })
    const unsubscribeHover = window.cradle?.window.onCaptionHover?.((event) => {
      if (!isCaptionButtonId(event.button)) {
        return
      }
      if (event.phase === 'enter') {
        setHoveredButton(event.button)
      }
      else if (event.phase === 'leave') {
        setHoveredButton(current => current === event.button ? null : current)
        setPressedButton(current => current === event.button ? null : current)
      }
      else if (event.phase === 'press') {
        setPressedButton(event.button)
      }
      else if (event.phase === 'release') {
        setPressedButton(null)
      }
    })
    return () => {
      unsubscribeMaximized?.()
      unsubscribeHover?.()
    }
  }, [])

  const handleRectsChange = useCallback((rects: CaptionButtonRect[]) => {
    rectsRef.current = rects
    if (!isElectron || platform !== 'win32' || rects.length === 0) {
      return
    }
    const scale = window.devicePixelRatio
    const byButton = new Map(rects.map(rect => [rect.button, rect]))
    const toPhysical = (button: CaptionButtonId) => {
      const rect = byButton.get(button)
      return rect && {
        x: Math.round(rect.x * scale),
        y: Math.round(rect.y * scale),
        width: Math.round(rect.width * scale),
        height: Math.round(rect.height * scale),
      }
    }
    void nativeIpc?.window.setCaptionButtons({
      minimize: toPhysical('minimize'),
      maximize: toPhysical('maximize'),
      close: toPhysical('close'),
    }).catch(() => {})
  }, [])

  const handleButtonClick = useCallback((button: CaptionButtonId) => {
    const controls = window.cradle?.window
    if (!controls) {
      return
    }
    if (button === 'minimize') {
      void controls.minimize()
    }
    else if (button === 'maximize') {
      void controls.maximize()
    }
    else {
      void controls.close()
    }
  }, [])

  return (
    <WindowsCaptionButtonsView
      maximized={maximized}
      hoveredButton={hoveredButton}
      pressedButton={pressedButton}
      labels={{
        minimize: t('windowControl.minimize'),
        maximize: t('windowControl.maximize'),
        restore: t('windowControl.restore'),
        close: t('windowControl.close'),
      }}
      onRectsChange={handleRectsChange}
      onButtonClick={handleButtonClick}
    />
  )
}
