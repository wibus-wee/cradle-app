import { Elysia } from 'elysia'

import { ImageOcrModel } from './model'
import { recognizeImages } from './service'

export const imageOcr = new Elysia({
  prefix: '/image-ocr',
  detail: { tags: ['image-ocr'] },
}).post('/recognize', async ({ body }) => ({ items: await recognizeImages(body.files) }), {
  detail: {
    summary: 'Recognize text in local image attachments with Light OCR',
  },
  body: ImageOcrModel.recognizeBody,
  response: { 200: ImageOcrModel.recognizeResponse },
})
