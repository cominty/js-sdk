/**
 * Smoke-test the package exactly as a consumer receives it.
 *
 * Packs the tarball, installs it into a throwaway project, then imports it by
 * name and drives one request through a mocked `fetch`. Catches what unit tests
 * cannot: a broken `exports` map, a file missing from `files`, or an import that
 * only resolves inside this repo.
 *
 *   pnpm build && node scripts/smoke.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'cominty-sdk-smoke-'))

const CONSUMER = `
import assert from 'node:assert/strict'
import { Cominty, ComintyError, InvalidParams, isKnownEvent } from '@cominty-ai/sdk'

const calls = []
const client = new Cominty({
    apiToken: 'test-key',
    userId: 'user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ',
    fetch: async (url, init) => {
        calls.push({ url: String(url), headers: init.headers })
        return new Response('[]', { status: 200 })
    },
})

assert.deepEqual(await client.threads.list(), [])
assert.equal(calls.length, 1)
assert.equal(calls[0].headers['x-cominty-token'], 'test-key')

await assert.rejects(() => client.chat.start({ agentId: '', message: 'hi' }), InvalidParams)
assert.ok(InvalidParams.prototype instanceof ComintyError)
assert.equal(typeof isKnownEvent, 'function')

console.log('smoke test passed on node ' + process.version)
`

try {
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work], {
        cwd: root,
        stdio: 'ignore',
    })
    const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'))
    if (!tarball) throw new Error('npm pack produced no tarball — did you run the build?')

    writeFileSync(
        join(work, 'package.json'),
        JSON.stringify({ name: 'smoke', private: true, type: 'module' }),
    )
    writeFileSync(join(work, 'consumer.mjs'), CONSUMER)
    execFileSync('npm', ['install', '--no-audit', '--no-fund', `./${tarball}`], {
        cwd: work,
        stdio: 'ignore',
    })
    execFileSync(process.execPath, ['consumer.mjs'], { cwd: work, stdio: 'inherit' })
} finally {
    rmSync(work, { recursive: true, force: true })
}
