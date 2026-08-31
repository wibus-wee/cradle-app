import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })

const fabricScope = t.Union([t.Literal('view'), t.Literal('control'), t.Literal('approve'), t.Literal('admin')])
const controllerGrantScope = t.Union([t.Literal('view'), t.Literal('control'), t.Literal('approve')])
const relayAccessMode = t.Union([t.Literal('local'), t.Literal('network'), t.Literal('external')])

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
    scopes: t.Optional(t.Array(fabricScope)),
  },
  { additionalProperties: false },
)

const nodeGrant = t.Object(
  {
    grantId: t.String(),
    fabricId: t.String(),
    controllerId: t.String(),
    controllerDisplayName: t.Optional(t.String()),
    nodeId: t.String(),
    scope: fabricScope,
    revokedAt: t.Optional(t.String()),
  },
  { additionalProperties: false },
)

export const FabricModel = {
  updateRelayUrlBody: t.Object(
    { relayUrl: nonBlankString },
    { additionalProperties: false },
  ),
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
  pendingEnrollment: t.Union([
    t.Object(
      {
        version: t.Literal(1),
        relayUrl: t.String(),
        fabricId: t.String(),
        requestId: t.String(),
        deliverySecret: t.String(),
        expiresAt: t.Union([t.String(), t.Null()]),
        createdAt: t.Number(),
      },
      { additionalProperties: false },
    ),
    t.Null(),
  ]),
  pendingNodeRequest: t.Object(
    {
      requestId: t.String(),
      displayName: t.String(),
      platform: t.String(),
      version: t.String(),
      capabilities: t.Array(t.String()),
      requestedAt: t.String(),
      expiresAt: t.String(),
    },
    { additionalProperties: false },
  ),
  pendingControllerRequest: t.Object(
    {
      requestId: t.String(),
      subjectId: t.String(),
      identityPubkey: t.String(),
      encryptionPubkey: t.String(),
      displayName: t.String(),
      platform: t.String(),
      version: t.String(),
      capabilities: t.Array(t.String()),
      requestedAt: t.String(),
      expiresAt: t.String(),
    },
    { additionalProperties: false },
  ),
  approveControllerRequest: t.Object(
    {
      grants: t.Array(t.Object(
        {
          nodeId: nonBlankString,
          scopes: t.Array(controllerGrantScope, { minItems: 1, uniqueItems: true }),
        },
        { additionalProperties: false },
      ), { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  controllerApproval: t.Object(
    { fabricId: t.String(), controllerId: t.String() },
    { additionalProperties: false },
  ),
  requestIdParams: t.Object({ requestId: nonBlankString }, { additionalProperties: false }),
  controllerIdParams: t.Object({ controllerId: nonBlankString }, { additionalProperties: false }),
  nodeIdParams: t.Object({ nodeId: nonBlankString }, { additionalProperties: false }),
  nodeGrantParams: t.Object({ nodeId: nonBlankString, grantId: nonBlankString }, { additionalProperties: false }),
  nodeGrant,
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
  managedRelay: t.Union([
    t.Object(
      {
        relayUrl: t.String(),
        accessMode: relayAccessMode,
      },
      { additionalProperties: false },
    ),
    t.Null(),
  ]),
  managedRelayResources: t.Object(
    {
      source: t.Union([t.Literal('managed'), t.Literal('external'), t.Literal('unavailable')]),
      running: t.Boolean(),
      pid: t.Nullable(t.Number()),
      rssMB: t.Nullable(t.Number()),
      cpuPercent: t.Nullable(t.Number()),
      descendantCount: t.Nullable(t.Number()),
    },
    { additionalProperties: false },
  ),
  nodeSummary,
} as const
