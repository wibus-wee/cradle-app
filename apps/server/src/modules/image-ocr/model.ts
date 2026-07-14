import { t } from 'elysia'

import { filePartSchema } from '../chat-runtime/model/common-schemas'

export const ImageOcrModel = {
  recognizeBody: t.Object(
    {
      files: t.Array(filePartSchema, { minItems: 1, maxItems: 8 }),
    },
    { additionalProperties: false },
  ),
  recognizeResponse: t.Object({
    items: t.Array(
      t.Object(
        {
          index: t.Number({ minimum: 0 }),
          text: t.String(),
          lineCount: t.Number({ minimum: 0 }),
          modelBundleId: t.String(),
        },
        { additionalProperties: false },
      ),
    ),
  }),
}
