import { Elysia } from 'elysia'

import { LinkPreviewModel } from './model'
import * as LinkPreview from './service'

export const linkPreview = new Elysia({
  prefix: '/link-preview',
  detail: { tags: ['link-preview'] },
})
  .get('/', ({ query }) => LinkPreview.getPreview(query.url), {
    detail: {
      'summary': 'Get link preview',
      'description': 'Unfurl an http(s) URL into OpenGraph metadata for rendering a link card. Server-side fetch with SSRF protection and a short-lived in-memory cache.',
      'x-cradle-cli': {
        command: ['link-preview', 'get'],
      },
    },
    query: LinkPreviewModel.query,
    response: { 200: LinkPreviewModel.preview },
  })
