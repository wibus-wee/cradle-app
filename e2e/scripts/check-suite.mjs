import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const featureDir = join(root, 'e2e/src/features')
const stepDir = join(root, 'e2e/src/steps')
const pageDir = join(root, 'e2e/src/support/pages')
const featureReadmePath = join(featureDir, 'README.md')
const stepReadmePath = join(stepDir, 'README.md')
const supportReadmePath = join(root, 'e2e/src/support/README.md')
const coveragePath = join(root, 'e2e/COVERAGE.md')

const cucumberRequire = createRequire(import.meta.resolve('@cucumber/cucumber/package.json'))
const { generateMessages } = cucumberRequire('@cucumber/gherkin')
const { IdGenerator, SourceMediaType } = cucumberRequire('@cucumber/messages')

const failures = []

function fail(message) {
  failures.push(message)
}

function filesIn(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .map(entry => entry.name)
    .sort()
}

function assertIndexed(readmePath, filenames, label) {
  const readme = readFileSync(readmePath, 'utf8')
  for (const filename of filenames) {
    if (!readme.includes(`\`${filename}\``)) {
      fail(`${relative(root, readmePath)} does not index ${label} ${filename}`)
    }
  }
}

const featureFiles = filesIn(featureDir, '.feature')
const pickles = []
for (const filename of featureFiles) {
  const uri = `e2e/src/features/${filename}`
  const envelopes = generateMessages(
    readFileSync(join(featureDir, filename), 'utf8'),
    uri,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    {
      defaultDialect: 'zh-CN',
      includeSource: false,
      includeGherkinDocument: true,
      includePickles: true,
      newId: IdGenerator.incrementing(),
    },
  )
  for (const envelope of envelopes) {
    if (envelope.parseError) {
      fail(`${uri}:${envelope.parseError.source?.location?.line ?? '?'} ${envelope.parseError.message}`)
    }
    if (envelope.pickle) {
      pickles.push(envelope.pickle)
    }
  }
}

const stableIds = new Map()
const p0StableIds = new Set()
let p0Count = 0
let p1Count = 0
for (const pickle of pickles) {
  const tags = pickle.tags.map(tag => tag.name)
  const location = `${pickle.uri}:${pickle.location?.line ?? '?'}`
  if (!tags.includes('@cradle')) {
    fail(`${location} ${pickle.name} is missing @cradle`)
  }
  if (!tags.includes('@essence')) {
    fail(`${location} ${pickle.name} is missing @essence`)
  }
  if (tags.includes('@wip')) {
    fail(`${location} ${pickle.name} must not use @wip`)
  }

  const priorities = tags.filter(tag => tag === '@P0' || tag === '@P1')
  if (priorities.length !== 1) {
    fail(`${location} ${pickle.name} must have exactly one of @P0 or @P1`)
  }
  if (priorities[0] === '@P0') { p0Count += 1 }
  if (priorities[0] === '@P1') { p1Count += 1 }

  const runtimes = tags.filter(tag => tag === '@runtime-claude' || tag === '@runtime-codex' || tag === '@runtime-none')
  if (runtimes.length !== 1) {
    fail(`${location} ${pickle.name} must have exactly one runtime ownership tag`)
  }
  if (tags.includes('@serial') && runtimes[0] !== '@runtime-codex') {
    fail(`${location} ${pickle.name} may use @serial only for the Codex runtime lane`)
  }

  const ids = tags.filter(tag => /^@CRADLE-[A-Z0-9-]+-\d{3}$/.test(tag))
  if (ids.length !== 1) {
    fail(`${location} ${pickle.name} must have exactly one stable @CRADLE-*-NNN ID`)
    continue
  }
  const previous = stableIds.get(ids[0])
  if (previous) {
    fail(`${location} duplicates ${ids[0]} already used by ${previous}`)
  }
  else {
    stableIds.set(ids[0], `${location} ${pickle.name}`)
    if (priorities[0] === '@P0') {
      p0StableIds.add(ids[0].slice(1))
    }
  }
}

assertIndexed(featureReadmePath, featureFiles, 'feature')
assertIndexed(stepReadmePath, filesIn(stepDir, '.steps.ts'), 'step file')
assertIndexed(supportReadmePath, filesIn(pageDir, '.ts').map(name => `pages/${name}`), 'page object')

const featureReadme = readFileSync(featureReadmePath, 'utf8')
const expectedCountSentence = `The active suite contains ${pickles.length} scenarios: ${p0Count} \`@P0\` smoke journeys and ${p1Count} \`@P1\` deeper journeys.`
if (!featureReadme.includes(expectedCountSentence)) {
  fail(`e2e/src/features/README.md must contain the current count sentence: ${expectedCountSentence}`)
}

function directoryNames(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function assertModuleDisposition(heading, directory) {
  const coverage = readFileSync(coveragePath, 'utf8')
  const section = coverage.split(`## ${heading}`)[1]?.split('\n## ')[0]
  if (!section) {
    fail(`e2e/COVERAGE.md is missing section ${heading}`)
    return
  }

  const listed = new Set()
  const rows = section.split('\n').filter(line => /^\| (Direct|Indirect|User-visible gap|Service\/infra contract) \|/.test(line))
  for (const row of rows) {
    const namespaceColumn = row.split('|')[2] ?? ''
    for (const match of namespaceColumn.matchAll(/`([^`]+)`/g)) {
      if (listed.has(match[1])) {
        fail(`${heading} lists ${match[1]} more than once`)
      }
      listed.add(match[1])
    }
  }

  const actual = new Set(directoryNames(directory))
  for (const name of actual) {
    if (!listed.has(name)) { fail(`${heading} does not classify ${name}`) }
  }
  for (const name of listed) {
    if (!actual.has(name)) { fail(`${heading} lists removed namespace ${name}`) }
  }
}

assertModuleDisposition('Web Feature Namespace Disposition', join(root, 'apps/web/src/features'))
assertModuleDisposition('Server Module Namespace Disposition', join(root, 'apps/server/src/modules'))

const coverage = readFileSync(coveragePath, 'utf8')
const stateFusionSection = coverage.split('## State-Fusion Matrix')[1]?.split('\n## ')[0] ?? ''
for (const stableId of p0StableIds) {
  if (!stateFusionSection.includes(`\`${stableId}\``)) {
    fail(`e2e/COVERAGE.md State-Fusion Matrix does not cover P0 scenario ${stableId}`)
  }
}

for (const markdownPath of [coveragePath, featureReadmePath, stepReadmePath, supportReadmePath]) {
  const markdown = readFileSync(markdownPath, 'utf8')
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^https?:/.test(target)) { continue }
    const resolved = resolve(dirname(markdownPath), target)
    if (!existsSync(resolved)) {
      fail(`${relative(root, markdownPath)} links to missing path ${target}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`E2E suite contract failed with ${failures.length} issue(s):`)
  for (const failure of failures) { console.error(`- ${failure}`) }
  process.exitCode = 1
}
else {
  console.log(`E2E suite contract passed: ${pickles.length} scenarios (${p0Count} P0, ${p1Count} P1), ${stableIds.size} unique IDs, ${featureFiles.length} feature files.`)
}
