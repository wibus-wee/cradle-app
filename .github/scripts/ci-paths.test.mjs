/* eslint-disable no-template-curly-in-string -- GitHub expressions are literal workflow values. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, matchesGlob } from 'node:path'
// This workflow contract runs directly in Node, outside the application Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { test } from 'node:test'

import { load } from 'js-yaml'

const readYaml = path => load(readFileSync(new URL(path, import.meta.url), 'utf8'))
const filters = readYaml('../ci-paths.yml')
const ci = readYaml('../workflows/ci.yml')
const matches = (scope, path) => filters[scope].flat(Infinity).some(pattern => matchesGlob(path, pattern))

for (const [path, enabled, skipped] of [
  ['README.md', [], ['lint', 'mobile', 'relayd', 'chronicle', 'unit', 'server_tests', 'build_web', 'build_server', 'build_desktop', 'e2e', 'deploy_web', 'release_desktop']],
  ['apps/mobile/src/app.tsx', ['lint', 'mobile', 'unit'], ['web', 'server', 'desktop', 'simulator', 'relayd', 'chronicle', 'build_web', 'build_server', 'build_desktop', 'e2e', 'deploy_web', 'release_desktop']],
  ['apps/server/src/app.ts', ['server', 'server_tests', 'build_server', 'build_desktop', 'e2e', 'release_desktop'], ['mobile', 'web', 'desktop', 'simulator', 'relayd', 'chronicle', 'build_web', 'deploy_web']],
  ['apps/web/src/app.tsx', ['web', 'unit', 'build_web', 'build_desktop', 'e2e', 'deploy_web', 'release_desktop'], ['mobile', 'server', 'server_tests', 'relayd', 'chronicle']],
  ['apps/relayd/main.go', ['relayd', 'server_tests', 'build_desktop', 'e2e', 'release_desktop'], ['mobile', 'web', 'server', 'build_web', 'build_server', 'deploy_web']],
  ['chronicle/src/lib.rs', ['chronicle', 'release_desktop'], ['mobile', 'relayd', 'build_web', 'build_server', 'build_desktop', 'e2e', 'deploy_web']],
  ['apps/landing/changelog/release.en.md', ['deploy_web'], ['mobile', 'build_web', 'build_server', 'build_desktop', 'e2e', 'release_desktop']],
  ['packages/ai-sdk/src/index.ts', ['mobile', 'web', 'server', 'e2e'], ['relayd', 'chronicle']],
  ['packages/fabric-protocol/src/index.ts', ['mobile', 'web', 'server', 'e2e'], ['relayd', 'chronicle']],
  ['pnpm-lock.yaml', ['mobile', 'web', 'server', 'desktop', 'simulator', 'e2e', 'deploy_web', 'release_desktop'], ['relayd', 'chronicle']],
  ['.github/actions/e2e-run/action.yml', ['e2e'], ['mobile', 'build_web', 'build_server', 'build_desktop', 'deploy_web', 'release_desktop']],
  ['.github/actions/desktop-build-setup/action.yml', ['release_desktop'], ['mobile', 'e2e', 'deploy_web']],
]) {
  test(`scope for ${path}`, () => {
    for (const scope of enabled) { assert.ok(matches(scope, path), `${scope} must run`) }
    for (const scope of skipped) { assert.ok(!matches(scope, path), `${scope} must skip`) }
  })
}

test('matrix resolver skips empty builds and retains the mobile unit-test prerequisite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cradle-ci-scope-'))
  try {
    for (const [name, env, builds, typechecks, shared] of [
      ['docs', {}, [], [], false],
      ['mobile', { UNIT: 'true' }, [], [], true],
      ['web', { WEB: 'true', BUILD_WEB: 'true', BUILD_DESKTOP: 'true' }, ['web', 'desktop'], ['web'], true],
      ['server', { SERVER: 'true', BUILD_SERVER: 'true', BUILD_DESKTOP: 'true' }, ['server', 'desktop'], ['node', 'server'], true],
    ]) {
      const output = join(directory, name)
      const step = ci.jobs.changes.steps.find(step => step.id === 'matrix')
      execFileSync('bash', ['-e', '-c', step.run], {
        env: { PATH: process.env.PATH, ...env, GITHUB_OUTPUT: output },
      })
      const result = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')))
      assert.deepEqual(JSON.parse(result.build_targets), builds)
      assert.deepEqual(JSON.parse(result.typecheck_targets), typechecks)
      assert.equal(result.shared, String(shared))
    }
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('empty matrices are gated before expansion and all artifact consumers retain their prerequisite', () => {
  assert.equal(ci.jobs.build.if, 'needs.changes.outputs.build_targets != \'[]\'')
  assert.equal(ci.jobs.typecheck.if, 'needs.changes.outputs.typecheck_targets != \'[]\'')
  for (const job of ['build', 'typecheck', 'unit-tests', 'server-tests']) {
    assert.ok(ci.jobs[job].needs.includes('shared-artifacts'))
  }
  assert.equal(ci.jobs.changes.steps.find(step => step.id === 'filter').with.base, '${{ github.event.before || github.event.repository.default_branch }}')
})

test('forced E2E uses current labels, and scheduled/manual suites remain unconditional', () => {
  const smoke = readYaml('../workflows/e2e-smoke.yml')
  assert.ok(smoke.on.pull_request.types.includes('unlabeled'))
  assert.ok(!smoke.jobs.gate.if.includes('github.event.label.name'))
  assert.ok(smoke.jobs.gate.if.includes('contains(github.event.pull_request.labels.*.name, \'e2e-full\')'))
  const daily = readYaml('../workflows/e2e-daily.yml')
  assert.ok(daily.on.schedule)
  assert.ok(daily.on.workflow_dispatch)
  assert.equal(daily.jobs.e2e.if, undefined)
  for (const [file, job] of [['deploy-web', 'deploy-web'], ['release-desktop', 'resolve']]) {
    const workflow = readYaml(`../workflows/${file}.yml`)
    assert.ok(workflow.jobs[job].if.includes('github.event_name == \'workflow_dispatch\''))
    assert.equal(workflow.jobs.changes.steps.find(step => step.id === 'filter').with.base, '${{ github.event.before }}')
    if (file === 'release-desktop') { assert.ok(workflow.jobs[job].if.includes('github.ref_type == \'tag\'')) }
  }
})
