const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const yaml = require('js-yaml')

const {
  ACTION_LABEL,
  CONTINUATION_LABEL,
  RESPONSE_LABEL,
  loadMaestroInteractionSamples,
  parseMaestroCommandEntries,
} = require('./maestro-performance.cjs')

function command(sequenceNumber, timestamp, duration, status, type, label) {
  return {
    command: { [type]: { label } },
    metadata: {
      sequenceNumber,
      timestamp,
      duration,
      status,
      evaluatedCommand: { [type]: { label } },
    },
  }
}

test('measures a Maestro action through its labeled visible response', () => {
  const samples = parseMaestroCommandEntries([
    command(0, 1_000, 100, 'COMPLETED', 'tapOnElement', 'perf-action:open-settings|open Settings'),
    command(1, 1_100, 30, 'COMPLETED', 'inputTextCommand', 'perf-continuation:open-settings'),
    command(2, 1_130, 270, 'COMPLETED', 'assertConditionCommand', 'perf-response:open-settings|Settings is visible'),
  ], { flowName: 'settings', stableId: 'CRADLE-FABRIC-002' })

  assert.deepEqual(samples, [{
    key: 'CRADLE-FABRIC-002::open Settings',
    stableId: 'CRADLE-FABRIC-002',
    feature: 'settings.yaml',
    scenario: 'settings',
    action: 'open Settings',
    responses: ['Settings is visible'],
    responseBoundary: 'maestro-visible-assertion',
    source: 'mobile-ios',
    durationMs: 400,
    status: 'PASSED',
  }])
})

test('ignores an unselected conditional branch and retains an interrupted action', () => {
  const samples = parseMaestroCommandEntries([
    command(0, 1_000, 200, 'SKIPPED', 'tapOnElement', 'perf-action:open-settings|open Settings'),
    command(1, 1_200, 100, 'SKIPPED', 'assertConditionCommand', 'perf-response:open-settings|Settings is visible'),
    command(2, 1_300, 150, 'COMPLETED', 'tapOnElement', 'perf-action:send-chat|send Chat'),
    command(3, 1_450, 30_000, 'FAILED', 'assertConditionCommand', null),
  ], { flowName: 'chat', stableId: 'CRADLE-FABRIC-002' })

  assert.equal(samples.length, 1)
  assert.equal(samples[0].action, 'send Chat')
  assert.equal(samples[0].durationMs, 30_150)
  assert.equal(samples[0].status, 'FAILED')
  assert.equal(samples[0].responseBoundary, 'maestro-interrupted')
})

test('rejects overlapping or mismatched Maestro boundaries', () => {
  assert.throws(() => parseMaestroCommandEntries([
    command(0, 1_000, 10, 'COMPLETED', 'tapOnElement', 'perf-action:first|first action'),
    command(1, 1_010, 10, 'COMPLETED', 'tapOnElement', 'perf-action:second|second action'),
  ], { flowName: 'invalid', stableId: 'CRADLE-FABRIC-002' }), /has no response/)

  assert.throws(() => parseMaestroCommandEntries([
    command(0, 1_000, 10, 'COMPLETED', 'tapOnElement', 'perf-action:first|first action'),
    command(1, 1_010, 10, 'COMPLETED', 'assertConditionCommand', 'perf-response:second|second response'),
  ], { flowName: 'invalid', stableId: 'CRADLE-FABRIC-002' }), /no matching action/)

  assert.throws(() => parseMaestroCommandEntries([
    command(0, 1_000, 10, 'COMPLETED', 'inputTextCommand', 'perf-continuation:first'),
  ], { flowName: 'invalid', stableId: 'CRADLE-FABRIC-002' }), /no matching action/)
})

test('loads commands.json artifacts from each Maestro flow', (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cradle-maestro-performance-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const flowDir = path.join(root, 'tests', 'run-1', 'select-node')
  fs.mkdirSync(flowDir, { recursive: true })
  fs.writeFileSync(path.join(flowDir, 'commands.json'), JSON.stringify([
    command(0, 2_000, 20, 'COMPLETED', 'tapOnElement', 'perf-action:select-node|select a Node'),
    command(1, 2_020, 80, 'COMPLETED', 'assertConditionCommand', 'perf-response:select-node|Node Workspaces are visible'),
  ]))

  const samples = loadMaestroInteractionSamples(root)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].scenario, 'select-node')
  assert.equal(samples[0].durationMs, 100)
})

function flattenCommands(commands) {
  return commands.flatMap((command) => {
    const nested = command.runFlow?.commands || command.repeat?.commands || []
    return [command, ...flattenCommands(nested)]
  })
}

test('every maintained Maestro user operation has a paired performance response', () => {
  const flowsDir = path.join(__dirname, '..', 'mobile', 'maestro')
  for (const fileName of fs.readdirSync(flowsDir).filter(name => name.endsWith('.yaml'))) {
    const documents = []
    yaml.loadAll(fs.readFileSync(path.join(flowsDir, fileName), 'utf8'), document => documents.push(document))
    const flow = documents.at(-1)
    const commands = flattenCommands(flow)
    const actionIds = new Set()
    const continuationIds = new Set()
    const responseIds = new Set()

    for (const command of commands) {
      if (!command || typeof command !== 'object') {
        continue
      }
      for (const operation of ['launchApp', 'tapOn', 'inputText']) {
        if (!(operation in command)) {
          continue
        }
        assert.equal(typeof command[operation], 'object', `${fileName} ${operation} must carry a performance label`)
        const actionMatch = ACTION_LABEL.exec(command[operation].label || '')
        const continuationMatch = CONTINUATION_LABEL.exec(command[operation].label || '')
        assert.ok(actionMatch || continuationMatch, `${fileName} ${operation} must use a performance label`)
        if (actionMatch) {
          actionIds.add(actionMatch[1])
        }
        if (continuationMatch) {
          continuationIds.add(continuationMatch[1])
        }
      }
      for (const value of Object.values(command)) {
        const match = RESPONSE_LABEL.exec(value?.label || '')
        if (match) {
          responseIds.add(match[1])
        }
      }
    }

    assert.deepEqual([...responseIds].sort(), [...actionIds].sort(), `${fileName} action/response labels must match`)
    assert.deepEqual(
      [...continuationIds].filter(id => !actionIds.has(id)),
      [],
      `${fileName} continuations must belong to an action`,
    )
  }
})
