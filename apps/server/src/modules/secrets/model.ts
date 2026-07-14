import { t } from 'elysia'

export const SecretsModel = {
  chatgptCredentialSummary: t.Object({
    chatgptAccountId: t.String(),
    chatgptPlanType: t.Union([t.String(), t.Null()]),
    updatedAt: t.Number(),
  }),

  secretMetadata: t.Object({
    id: t.String(),
    kind: t.String(),
    label: t.String(),
    maskedSecret: t.String(),
    chatgpt: t.Optional(t.Union([
      t.Object({
        chatgptAccountId: t.String(),
        chatgptPlanType: t.Union([t.String(), t.Null()]),
        updatedAt: t.Number(),
      }),
      t.Null(),
    ])),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  revealedSecret: t.Object({
    secret: t.String(),
  }),

  saveBody: t.Object({
    kind: t.String({ minLength: 1 }),
    label: t.String({ minLength: 1 }),
    secret: t.String({ minLength: 1 }),
  }),

}
