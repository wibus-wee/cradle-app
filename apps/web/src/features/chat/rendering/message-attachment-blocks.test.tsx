import { formatBlobUrl } from '@cradle/chat-runtime-contracts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CradleAppshotMetadata } from '../composer/appshot-attachment-model'
import { createCradleAppshotFilePart } from '../composer/appshot-attachment-model'
import { FileAttachmentBlock } from './message-attachment-blocks'

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:21423',
}))

vi.mock('../composer/appshot-attachment', () => ({
  AppshotAttachmentCard: ({ metadata }: { metadata: CradleAppshotMetadata }) => (
    <img data-testid="appshot-image" src={metadata.imageDataUrl} alt={metadata.imageName} />
  ),
}))

afterEach(cleanup)

describe('fileAttachmentBlock', () => {
  it('resolves an externalized AppShot through the session-scoped content route', () => {
    const part = createCradleAppshotFilePart({
      mediaType: 'image/png',
      filename: 'AppShot.png',
      imageDataUrl: 'data:image/png;base64,original',
      imagePath: null,
      transitionSnapshotDataUrl: null,
      transitionSnapshotHeight: null,
      appName: 'Cradle',
      windowTitle: 'Chat',
      bundleIdentifier: 'app.cradle',
    })
    part.url = formatBlobUrl('blob-1')

    render(<FileAttachmentBlock part={part} sessionId="session-1" />)

    expect(screen.getByTestId('appshot-image').getAttribute('src')).toBe(
      'http://127.0.0.1:21423/chat/sessions/session-1/blobs/blob-1/content',
    )
  })
})
