import type { BrowserAnnotationRecord } from '~/store/browser-panel'

import screenshotUrl from './screenshots/browser-new-tab-ready.png'

const screenshot = {
  type: 'file',
  filename: 'browser-new-tab-ready.png',
  mediaType: 'image/png',
  url: screenshotUrl,
} as const

export const browserAnnotationFixtures = [
  {
    id: 'annotation-region',
    ownerId: 'fixture-owner',
    tabId: 'fixture-tab',
    title: 'Cradle Storybook',
    url: 'http://localhost:6006',
    body: 'Increase the spacing between the server rows.',
    anchor: {
      kind: 'region',
      x: 180,
      y: 120,
      width: 620,
      height: 300,
    },
    designChange: null,
    attachedImages: [],
    screenshot,
    elements: [],
    surfaceSize: {
      width: 1200,
      height: 800,
    },
    createdAt: 1_784_836_700,
    updatedAt: 1_784_836_700,
    status: 'saved',
  },
  {
    id: 'annotation-point',
    ownerId: 'fixture-owner',
    tabId: 'fixture-tab',
    title: 'Cradle Storybook',
    url: 'http://localhost:6006',
    body: 'Make this refresh action easier to discover.',
    anchor: {
      kind: 'point',
      x: 1_025,
      y: 92,
    },
    designChange: {
      color: '#111111',
      backgroundColor: '#f5f5f5',
    },
    attachedImages: [],
    screenshot,
    elements: [],
    surfaceSize: {
      width: 1200,
      height: 800,
    },
    createdAt: 1_784_836_760,
    updatedAt: 1_784_836_780,
    status: 'sent',
  },
] satisfies BrowserAnnotationRecord[]
