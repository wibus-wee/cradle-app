import { describe, expect, it } from 'vitest'

import {
  describeProviderInputPart,
  extractProviderInputText,
  projectProviderInputParts,
  projectTextOnlyInput,
} from './input-projector'

describe('provider input projector', () => {
  it('projects text, files, and Cradle context parts', () => {
    const parts = projectProviderInputParts({
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Inspect this' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'screenshot.png',
          url: 'data:image/png;base64,abc123',
        },
        {
          type: 'data-cradle-skill',
          data: {
            type: 'data-cradle-skill',
            name: 'review',
            path: '/tmp/review',
            scope: 'workspace',
            description: null,
          },
        },
        {
          type: 'data-cradle-plugin',
          data: {
            type: 'data-cradle-plugin',
            pluginName: '@cradle/github',
            displayName: 'GitHub',
            description: null,
            routeSegment: 'github',
            capabilities: [],
            mcpServers: ['github'],
            nativeMention: { name: 'github', path: 'mcp://github' },
          },
        },
      ],
    })

    expect(parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'Inspect this' }),
      expect.objectContaining({
        type: 'file',
        mediaType: 'image/png',
        filename: 'screenshot.png',
        url: 'data:image/png;base64,abc123',
      }),
      expect.objectContaining({
        type: 'skill',
        skill: expect.objectContaining({ name: 'review', path: '/tmp/review' }),
      }),
      expect.objectContaining({
        type: 'plugin',
        plugin: expect.objectContaining({ pluginName: '@cradle/github', provider: 'cradle' }),
      }),
    ])
  })

  it('extracts text in AI SDK message order', () => {
    expect(extractProviderInputText({
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    })).toBe('first\nsecond')
  })

  it('validates text-only provider input', () => {
    expect(projectTextOnlyInput(' hello ', 'test provider')).toBe('hello')
    expect(() => projectTextOnlyInput({
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', url: 'file:///tmp/image.png' }],
    }, 'test provider')).toThrow('test provider only supports text input; unsupported parts: file (image/png)')
  })

  it('describes provider input parts for provider-owned errors', () => {
    const [filePart] = projectProviderInputParts({
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'file', mediaType: 'image/png', filename: 'chart.png', url: 'file:///tmp/chart.png' }],
    })

    expect(filePart ? describeProviderInputPart(filePart) : null).toBe('file (chart.png) (image/png)')
  })
})
