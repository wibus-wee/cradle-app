# Cradle Fabric Protocol

This directory is the language-neutral contract for relayd clients. The JSON
Schema defines signed control-plane documents. This document defines enrollment
behavior and the binary data plane used by native Controllers and Cradle Nodes.

| Layer | Version | Owner | Visibility |
| --- | --- | --- | --- |
| Membership documents | 1 | [`fabric-v1.json`](./fabric-v1.json) | Relayd validates signed JSON and stores public metadata. |
| Fabric envelope | 3 | [`internal/relay`](../internal/relay) | Relayd reads route, kind, priority, sequence, and lengths. |
| Fabric Session | 2 | [`apps/server/src/modules/relay-transport`](../../server/src/modules/relay-transport) | Only the Node and Controller read inner frames and application bytes. |

All integers in binary frames are unsigned and big-endian. Strings are UTF-8.
Public keys and signatures in JSON are standard padded Base64. Hashes used as
delivery-secret verifiers are unpadded Base64URL.

Signed JSON uses UTF-8, no insignificant whitespace, and the field order below.
Optional fields are omitted rather than encoded as `null`. Strings use
ECMAScript `JSON.stringify` escaping: quote, backslash, and U+0000 through
U+001F are escaped; all other Unicode scalar values, including U+2028 and
U+2029, are emitted as UTF-8. Certificate scopes and join-request capabilities
are sorted by Unicode code point before signing.

| Document | Signed field order |
| --- | --- |
| Certificate | `version`, `fabricId`, `subjectKind`, `subjectId`, `identityPubkey`, `encryptionPubkey`, optional `nodeId`, `scopes`, `issuedAt`, optional `expiresAt`, `nonce`, `issuerPubkey` |
| Join request | `requestId`, `fabricId`, `subjectKind`, `subjectId`, `identityPubkey`, `encryptionPubkey`, `displayName`, `platform`, `version`, `capabilities`, `deliverySecretHash`, `issuedAt`, `expiresAt` |
| Request proof | `pubkey`, `method`, `path`, `issuedAt`, `nonce` |

The signature is Ed25519 over those exact JSON bytes and is appended afterward
as the `signature` field. Implementations must not rely on a general-purpose
JSON encoder preserving declaration or dictionary order.

## Device enrollment

A joining device generates an Ed25519 identity key, an X25519 encryption key,
and a random delivery secret locally. It sends a signed `joinRequest` to `POST
/v1/join-requests`; relayd stores only `SHA-256(deliverySecret)`.

The request `subjectKind` determines approval:

| Subject | Owner approval | Durable result |
| --- | --- | --- |
| `node` | `nodeCertificate` plus a companion `controllerCertificate` | Node principal, Controller principal, Node directory record, and personal-device grants. |
| `controller` | One `controllerCertificate` plus at least one explicit Node grant | Controller principal and only the submitted grants; no Node record is created. |

For a Controller-only device, the certificate `nodeId` must identify the one
Node authorized during enrollment. The owner may grant only `view`, `control`,
or `approve`; Controller-only enrollment rejects `admin`. Relayd verifies that
every grant matches the certificate Fabric, Controller, required Node
restriction, and scopes before committing the certificate and grants
atomically.

The joining device polls `GET /v1/join-requests/{requestId}?secret=...`.
Pending and rejected responses disclose no certificate. An approved Node gets
both certificates; an approved Controller gets only `controllerCertificate`.
Repeating an identical approval or polling after a lost response is
idempotent. Reusing the request id with different signed content or approving
it with different certificate keys fails closed.

## Request authentication

Authenticated directory requests send two headers:

- `X-Cradle-Fabric-Certificate`: unpadded Base64URL of the certificate JSON.
- `X-Cradle-Fabric-Proof`: unpadded Base64URL of a `requestProof` JSON value.

The proof signs canonical JSON containing `pubkey`, uppercase HTTP `method`,
path without query, Unix-seconds `issuedAt`, and a unique `nonce`. Relayd binds
the proof to the certificate identity key, rejects stale timestamps, and
rejects nonce replay. Owner operations omit the certificate header and sign the
proof with the Fabric owner key.

## Opening a Controller link

The Controller lists its granted Nodes, then sends authenticated `POST
/v1/nodes/{nodeId}/links`. The response contains a transient `linkId` and the
owner-signed Node certificate. The Controller connects to `GET
/v1/ws/controllers/{linkId}` with a fresh certificate and proof header pair.
The Node holds the separate long-lived `GET /v1/ws/nodes` connection.

Each WebSocket binary message contains one Fabric v3 envelope. Its 24-byte
header is followed by `fabricId`, `nodeId`, `linkId`, optional `streamId`, and
payload bytes:

| Offset | Bytes | Field |
| --- | ---: | --- |
| 0 | 1 | Version, always `3`. |
| 1 | 1 | Kind: `1` link open, `2` link ready, `3` data, `4` peer closed, `5` relay error. |
| 2 | 1 | Priority: `1` control or `2` data. |
| 3 | 1 | Reserved, zero. |
| 4 | 2 | Fabric id byte length. |
| 6 | 2 | Node id byte length. |
| 8 | 2 | Link id byte length. |
| 10 | 2 | Stream id byte length. |
| 12 | 4 | Envelope sequence. |
| 16 | 4 | Acknowledgement field. |
| 20 | 4 | Payload byte length. |

Relayd validates these fields and routes the payload without decrypting it.

## Fabric Session v2 handshake

The Controller initiates the session with a plaintext 40-byte `hello` inner
frame. The Node returns one plaintext `hello` selection. Both hellos are inside
Fabric `relay_data_frame` envelopes.

| Offset | Bytes | Field |
| --- | ---: | --- |
| 0 | 1 | Inner kind, `1` for hello. |
| 1 | 1 | Session version, always `2`. |
| 2 | 1 | Flags: bit 0 is `selection`; all other bits are zero. |
| 3 | 1 | Cipher bit mask: bit 0 AES-256-GCM, bit 1 XChaCha20-Poly1305. |
| 4 | 1 | Compression bit mask: bit 0 Zstandard, bit 1 none. |
| 5 | 3 | Reserved, zero. |
| 8 | 32 | Raw X25519 public key. |

The Controller offer has `selection = 0` and may set multiple capability bits.
The Node selection has `selection = 1` and must set exactly one cipher bit and
one compression bit. A peer must reject an unsupported version, malformed mask,
unexpected offer/selection role, certificate-key mismatch, or empty
intersection. AES-256-GCM plus no compression is the portable baseline for
CryptoKit clients. Zstandard and XChaCha are optional and may be selected only
when both peers advertise them.

## Keys and encrypted frames

Both peers compute X25519 ECDH with the certificate-bound public keys. They
derive two 32-byte traffic keys with HKDF-SHA512:

```text
salt = UTF8(fabricId) || 0x00 || UTF8(linkId)
info = UTF8("cradle/fabric/session/v1/node-send")
info = UTF8("cradle/fabric/session/v1/controller-send")
```

The Node encrypts with `node-send`; the Controller decrypts with that key. The
reverse direction uses `controller-send`. No additional authenticated data is
used.

AES-256-GCM payloads are `12-byte nonce || ciphertext || 16-byte tag`; nonce
bit 7 is cleared. XChaCha20-Poly1305 payloads are `24-byte nonce || ciphertext
|| 16-byte tag`; nonce bit 7 is set. The receiver must reject a payload whose
marker does not match the negotiated cipher. Every frame uses a fresh random
nonce.

Encrypted inner frames use these layouts:

| Kind | Code | Header and body |
| --- | ---: | --- |
| Stream open | 2 | `streamIdLength:u16`, `reasonLength:u16 = 0`, `streamId` |
| Raw stream data | 3 | `streamIdLength:u16`, `streamByteOffset:u32`, `streamId`, `data` |
| Stream acknowledgement | 4 | `streamIdLength:u16`, `ackedBytes:u32`, `streamId` |
| Stream close | 5 | `streamIdLength:u16`, `reasonLength:u16`, `streamId`, optional `reason` |
| Zstandard stream data | 7 | `streamIdLength:u16`, `streamByteOffset:u32`, `uncompressedBytes:u32`, `streamId`, compressed data |

Each row starts with its one-byte kind code. `streamByteOffset` and
`ackedBytes` are cumulative uncompressed-byte positions, not frame counters.
The outer Fabric envelope `streamId` must match the encrypted inner `streamId`;
it exists only so relayd can schedule streams fairly without seeing content.

After the hello exchange, all inner frames are encrypted. Stream data is split
into at most 64 KiB of uncompressed bytes. A session negotiated as `none` must
never send the Zstandard stream-data code. A session negotiated as `zstd` may
still send raw chunks when they are small or compression would not save at
least 64 bytes. Receivers enforce declared output lengths before decompression.

## Application transport

After the session is ready, the Controller opens each stream as one byte-stream
connection to the Node's loopback Cradle Server. The first Controller bytes must
be a valid HTTP/1.0 or HTTP/1.1 request, with the complete header ending within
64 KiB. The Node removes any caller-supplied relay-auth header, injects its own
local tunnel credential, and uses connection-close semantics for ordinary HTTP
requests. Response bytes, including streaming response bodies, return on the
same Fabric stream.

The Controller therefore never stores or sends a Cradle Server HTTP
authentication token and does not need its URL or LAN address. It owns stream
IDs, opens one stream per HTTP connection, and sends `stream_close` when the
connection ends.

The Node closes its local TCP connection when it receives `stream_close`; a
local TCP close produces the reciprocal frame.

Flow control is cumulative per stream. Each direction starts with 512 KiB of
credit, acknowledges bytes only after its local consumer applies them, and may
grow to 8 MiB. Total unacknowledged data across the link is capped at 16 MiB.
Mutations and streams are never replayed automatically after link failure.
