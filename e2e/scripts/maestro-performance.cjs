const fs = require('node:fs')
const path = require('node:path')

const ACTION_LABEL = /^perf-action:([^|]+)\|(.+)$/
const CONTINUATION_LABEL = /^perf-continuation:([^|]+)$/
const RESPONSE_LABEL = /^perf-response:([^|]+)\|(.+)$/

function commandLabel(entry) {
  const evaluated = entry?.metadata?.evaluatedCommand || entry?.command
  if (!evaluated || typeof evaluated !== 'object') {
    return null
  }
  const command = Object.values(evaluated).find(value => value && typeof value === 'object')
  return typeof command?.label === 'string' ? command.label : null
}

function commandStatus(entry) {
  const status = String(entry?.metadata?.status || 'UNKNOWN').toUpperCase()
  if (status === 'COMPLETED') {
    return 'PASSED'
  }
  return status
}

function commandEnd(entry) {
  return Number(entry?.metadata?.timestamp || 0) + Number(entry?.metadata?.duration || 0)
}

function interactionStatus(actionStatus, responseStatus) {
  if (actionStatus === 'FAILED' || responseStatus === 'FAILED') {
    return 'FAILED'
  }
  return responseStatus || actionStatus
}

function sample(input, active, responseEntry, responseText) {
  const end = responseEntry ? commandEnd(responseEntry) : active.lastEnd
  return {
    key: `${input.stableId}::${active.action}`,
    stableId: input.stableId,
    feature: `${input.flowName}.yaml`,
    scenario: input.flowName,
    action: active.action,
    responses: responseText ? [responseText] : [],
    responseBoundary: responseEntry ? 'maestro-visible-assertion' : 'maestro-interrupted',
    source: 'mobile-ios',
    durationMs: Math.max(0, end - active.startedAt),
    status: responseEntry
      ? interactionStatus(active.status, commandStatus(responseEntry))
      : 'FAILED',
  }
}

function parseMaestroCommandEntries(entries, input) {
  const ordered = [...entries].sort(
    (left, right) => Number(left?.metadata?.sequenceNumber || 0) - Number(right?.metadata?.sequenceNumber || 0),
  )
  const interactions = []
  let active = null

  for (const entry of ordered) {
    if (commandStatus(entry) === 'SKIPPED') {
      continue
    }
    if (active) {
      active.lastEnd = Math.max(active.lastEnd, commandEnd(entry))
      active.status = interactionStatus(active.status, commandStatus(entry))
    }

    const label = commandLabel(entry)
    const actionMatch = ACTION_LABEL.exec(label || '')
    if (actionMatch) {
      if (active) {
        throw new Error(`Maestro interaction ${active.id} has no response before ${actionMatch[1]} in ${input.flowName}.`)
      }
      active = {
        id: actionMatch[1],
        action: actionMatch[2],
        startedAt: Number(entry.metadata.timestamp || 0),
        lastEnd: commandEnd(entry),
        status: commandStatus(entry),
      }
      continue
    }

    const continuationMatch = CONTINUATION_LABEL.exec(label || '')
    if (continuationMatch) {
      if (!active || active.id !== continuationMatch[1]) {
        throw new Error(`Maestro continuation ${continuationMatch[1]} has no matching action in ${input.flowName}.`)
      }
      continue
    }

    const responseMatch = RESPONSE_LABEL.exec(label || '')
    if (!responseMatch) {
      continue
    }
    if (!active || active.id !== responseMatch[1]) {
      throw new Error(`Maestro response ${responseMatch[1]} has no matching action in ${input.flowName}.`)
    }
    interactions.push(sample(input, active, entry, responseMatch[2]))
    active = null
  }

  if (active) {
    interactions.push(sample(input, active, null, null))
  }
  return interactions
}

function findCommandFiles(root) {
  if (!root || !fs.existsSync(root)) {
    return []
  }
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'debug' && !entry.name.endsWith('.xcresult')) {
          visit(entryPath)
        }
      }
      else if (entry.name === 'commands.json') {
        files.push(entryPath)
      }
    }
  }
  visit(root)
  return files.sort()
}

function loadMaestroInteractionSamples(root, stableId = 'CRADLE-FABRIC-002') {
  return findCommandFiles(root).flatMap((file) => {
    const flowName = path.basename(path.dirname(file))
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(entries)) {
      throw new TypeError(`Expected a Maestro command array in ${file}.`)
    }
    return parseMaestroCommandEntries(entries, { flowName, stableId })
  })
}

module.exports = {
  ACTION_LABEL,
  CONTINUATION_LABEL,
  RESPONSE_LABEL,
  loadMaestroInteractionSamples,
  parseMaestroCommandEntries,
}
