// FILE: browser-annotation-adjustment-panel.tsx
// Purpose: Container that wires BrowserPanel store into the Design/CSS inspector View.
// Layer: Browser feature UI Container
// Depends on: BrowserPanel Zustand store, BrowserAnnotationAdjustmentPanelView

import { useState } from 'react'

import type { BrowserAnnotationDesignStyleKey } from '~/store/browser-panel'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type { BrowserAnnotationInspectorTab } from './browser-annotation-adjustment-panel-view'
import {
  BrowserAnnotationAdjustmentPanelView,
} from './browser-annotation-adjustment-panel-view'

export const BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT = 'browser:annotation-adjustment-apply'

export interface BrowserAnnotationAdjustmentApplyDetail {
  ownerId: string
  tabId: string
}

export function BrowserAnnotationAdjustmentPanel() {
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const updateDesignChanges = useBrowserPanelStore(
    state => state.updateAnnotationAdjustmentDesignChanges,
  )
  const [activeTab, setActiveTab] = useState<BrowserAnnotationInspectorTab>('design')

  const handleFieldChange = (key: BrowserAnnotationDesignStyleKey, value: string) => {
    updateDesignChanges({ [key]: value })
  }

  const handleFieldReset = (key: BrowserAnnotationDesignStyleKey) => {
    updateDesignChanges({ [key]: '' })
  }

  const handleApply = () => {
    if (!adjustmentSession) {
      return
    }
    window.dispatchEvent(new CustomEvent<BrowserAnnotationAdjustmentApplyDetail>(
      BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT,
      {
        detail: {
          ownerId: adjustmentSession.ownerId,
          tabId: adjustmentSession.tabId,
        },
      },
    ))
  }

  return (
    <BrowserAnnotationAdjustmentPanelView
      selectedElement={adjustmentSession?.selectedElement ?? null}
      designChanges={adjustmentSession?.designChanges ?? {}}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      onDesignChange={handleFieldChange}
      onDesignReset={handleFieldReset}
      onApply={handleApply}
    />
  )
}
