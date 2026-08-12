import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const SECRET_NAMES = ['authorization', 'cookie', 'password', 'secret', 'token']
const REDACTION_MARKER = '[REDACTED]'

function isAsciiLetter(character) {
  return character !== undefined && /[a-z]/i.test(character)
}

function isSchemeCharacter(character) {
  return character !== undefined && /[a-z\d+.-]/i.test(character)
}

function isWordCharacter(character) {
  return character !== undefined && /\w/.test(character)
}

function isWhitespace(character) {
  return character !== undefined && /\s/.test(character)
}

function hasWordBoundary(value, start, length) {
  return !isWordCharacter(value[start - 1]) && !isWordCharacter(value[start + length])
}

function startsAsciiCaseInsensitive(value, expected, start) {
  for (let offset = 0; offset < expected.length; offset += 1) {
    const expectedCode = expected.charCodeAt(offset)
    const actualCode = value.charCodeAt(start + offset)
    if (actualCode !== expectedCode && actualCode !== expectedCode - 32) {
      return false
    }
  }
  return true
}

function startsAbsoluteUrlMarker(value, start) {
  if (!isAsciiLetter(value[start])) {
    return false
  }
  let schemeEnd = start + 1
  while (isSchemeCharacter(value[schemeEnd])) {
    schemeEnd += 1
  }
  return value.slice(schemeEnd, schemeEnd + 3) === '://'
}

function startsBearerValue(value, start) {
  const name = 'bearer'
  if (!startsAsciiCaseInsensitive(value, name, start) || !hasWordBoundary(value, start, name.length)) {
    return false
  }
  let valueStart = start + name.length
  if (!isWhitespace(value[valueStart])) {
    return false
  }
  while (isWhitespace(value[valueStart])) {
    valueStart += 1
  }
  return valueStart < value.length
}

function startsSecretAssignment(value, start) {
  for (const name of SECRET_NAMES) {
    if (!startsAsciiCaseInsensitive(value, name, start) || !hasWordBoundary(value, start, name.length)) {
      continue
    }
    let separator = start + name.length
    while (isWhitespace(value[separator])) {
      separator += 1
    }
    if (value[separator] === ':' || value[separator] === '=') {
      return true
    }
  }
  return false
}

export function redactDiagnosticText(value) {
  const text = String(value)
  for (let index = 0; index < text.length; index += 1) {
    if (
      startsAbsoluteUrlMarker(text, index)
      || startsBearerValue(text, index)
      || startsSecretAssignment(text, index)
    ) {
      return `${text.slice(0, index)}${REDACTION_MARKER}`
    }
  }
  return text
}

export function serializeDiagnosticError(error) {
  if (error instanceof Error) {
    return {
      name: redactDiagnosticText(error.name),
      message: redactDiagnosticText(error.message),
      code: typeof error.code === 'string' ? redactDiagnosticText(error.code) : null,
    }
  }
  return {
    name: 'NonError',
    message: redactDiagnosticText(error),
    code: null,
  }
}

export async function fileDiagnostic(path, { hash = false } = {}) {
  try {
    const metadata = await stat(path)
    const evidence = {
      path,
      exists: true,
      kind: metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'other',
      size: metadata.size,
      mode: metadata.mode,
      modifiedAt: metadata.mtime.toISOString(),
    }
    if (hash && metadata.isFile()) {
      evidence.sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
    }
    return evidence
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return { path, exists: false }
    }
    throw error
  }
}

export async function writeDiagnosticEnvelope(path, envelope) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}`
  const json = JSON.stringify(
    envelope,
    (_key, value) => typeof value === 'string' ? redactDiagnosticText(value) : value,
    2,
  )
  await writeFile(temporaryPath, `${json}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, path)
}
