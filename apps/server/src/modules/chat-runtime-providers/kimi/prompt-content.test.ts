import { describe, expect, it } from 'vitest'

import { projectKimiPrompt } from './prompt-content'

describe('projectKimiPrompt', () => {
  it('projects text, native skills, and image/video/file attachments', () => {
    const projection = projectKimiPrompt({
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Inspect these.' },
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aW1hZ2U=', filename: 'shot.png' },
        { type: 'file', mediaType: 'video/mp4', url: 'https://example.com/clip.mp4', filename: 'clip.mp4' },
        { type: 'file', mediaType: 'application/pdf', url: 'file:///tmp/report.pdf', filename: 'report.pdf' },
        {
          type: 'data-cradle-skill',
          data: {
            type: 'data-cradle-skill',
            name: 'review-runtime',
            path: '/skills/review-runtime',
            scope: 'repository',
            description: null,
          },
        },
      ],
    })

    expect(projection).toEqual({
      content: [
        { type: 'text', text: 'Inspect these.' },
        { type: 'image', source: { kind: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
        { type: 'video', source: { kind: 'url', url: 'https://example.com/clip.mp4' } },
        { type: 'file', path: '/tmp/report.pdf', media_type: 'application/pdf', name: 'report.pdf' },
      ],
      skills: [{ name: 'review-runtime' }],
    })
  })

  it('rejects remote non-media files instead of dropping them', () => {
    expect(() => projectKimiPrompt({
      id: 'user-1',
      role: 'user',
      parts: [{
        type: 'file',
        mediaType: 'application/pdf',
        url: 'https://example.com/report.pdf',
        filename: 'report.pdf',
      }],
    })).toThrow('remote URLs are only supported for image and video input')
  })
})
