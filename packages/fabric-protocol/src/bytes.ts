import { invalidFabricFrame } from './error'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const encoder = new TextEncoder()

export function utf8Bytes(value: string): Uint8Array {
  return encoder.encode(value)
}

export function compareUtf8(left: string, right: string): number {
  const leftBytes = utf8Bytes(left)
  const rightBytes = utf8Bytes(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!
    if (difference !== 0) {
      return difference
    }
  }
  return leftBytes.length - rightBytes.length
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    result += BASE64_ALPHABET[first >> 2]
    result += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    result += second === undefined
      ? '='
      : BASE64_ALPHABET[((second & 0x0F) << 2) | ((third ?? 0) >> 6)]
    result += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3F]
  }
  return result
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s/gu, '')
  if (
    normalized.length === 0
    || normalized.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)
  ) {
    throw invalidFabricFrame('Invalid Base64 value.')
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  const output = new Uint8Array((normalized.length / 4) * 3 - padding)
  let outputIndex = 0
  for (let index = 0; index < normalized.length; index += 4) {
    const a = base64Index(normalized[index]!)
    const b = base64Index(normalized[index + 1]!)
    const c = normalized[index + 2] === '=' ? 0 : base64Index(normalized[index + 2]!)
    const d = normalized[index + 3] === '=' ? 0 : base64Index(normalized[index + 3]!)
    const combined = (a << 18) | (b << 12) | (c << 6) | d
    if (outputIndex < output.length) { output[outputIndex++] = combined >> 16 }
    if (outputIndex < output.length) { output[outputIndex++] = (combined >> 8) & 0xFF }
    if (outputIndex < output.length) { output[outputIndex++] = combined & 0xFF }
  }
  return output
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/')
  return base64ToBytes(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
}

function base64Index(value: string): number {
  const index = BASE64_ALPHABET.indexOf(value)
  if (index < 0) {
    throw invalidFabricFrame('Invalid Base64 value.')
  }
  return index
}
