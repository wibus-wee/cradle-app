import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })

const nodeSummary = t.Object(
  {
    nodeId: t.String(),
    fabricId: t.String(),
    displayName: t.String(),
    platform: t.String(),
    version: t.String(),
    capabilities: t.Array(t.String()),
    status: t.Union([t.Literal('online'), t.Literal('offline')]),
    lastSeenAt: t.String(),
    revision: t.Number(),
  },
  { additionalProperties: false },
)

export const FabricModel = {
  createBody: t.Object(
    {
      relayUrl: nonBlankString,
      displayName: t.Optional(nonBlankString),
      platform: t.Optional(nonBlankString),
      version: t.Optional(nonBlankString),
      capabilities: t.Optional(t.Array(nonBlankString)),
    },
    { additionalProperties: false },
  ),
  beginNodeEnrollmentBody: t.Object(
    {
      relayUrl: nonBlankString,
      fabricId: nonBlankString,
      displayName: t.Optional(nonBlankString),
      platform: t.Optional(nonBlankString),
      version: t.Optional(nonBlankString),
      capabilities: t.Optional(t.Array(nonBlankString)),
    },
    { additionalProperties: false },
  ),
  invitation: t.Object(
    {
      version: t.Literal(1),
      relayUrl: t.String(),
      fabricId: t.String(),
      requestId: t.String(),
      deliverySecret: t.String(),
      expiresAt: t.String(),
    },
    { additionalProperties: false },
  ),
  nodeIdParams: t.Object({ nodeId: nonBlankString }, { additionalProperties: false }),
  link: t.Object(
    { linkId: t.String(), expiresAt: t.String(), nodeCertificate: t.Any() },
    { additionalProperties: false },
  ),
  membership: t.Object(
    {
      fabricId: t.String(),
      relayUrl: t.String(),
      localNodeId: t.String(),
      role: t.String(),
      ownerPubkey: t.String(),
      nodeCertificate: t.Any(),
      controllerCertificate: t.Optional(t.Any()),
      createdAt: t.Number(),
      updatedAt: t.Number(),
    },
    { additionalProperties: false },
  ),
  nullableMembership: t.Union([
    t.Object(
      {
        fabricId: t.String(),
        relayUrl: t.String(),
        localNodeId: t.String(),
        role: t.String(),
        ownerPubkey: t.String(),
        nodeCertificate: t.Any(),
        controllerCertificate: t.Optional(t.Any()),
        createdAt: t.Number(),
        updatedAt: t.Number(),
      },
      { additionalProperties: false },
    ),
    t.Null(),
  ]),
  nodeSummary,
} as const
