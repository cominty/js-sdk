/**
 * Index a local folder as a document source, give it to an agent, and ask about it.
 *
 *   node examples/09-sources.ts ./my-docs
 *
 * Without a folder, a small one is written to a temporary directory first. The
 * chat runs as the key's owner: sources made with an API key are private to the
 * admin who minted it.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cominty, SourceSyncFailed } from '../src/index.ts'
import { makeClient } from './_shared.ts'

async function demoFolder(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cominty-sources-'))
    await writeFile(join(dir, 'pricing.md'), '# Pricing\n\nThe Pro plan costs 42 euros a month.\n')
    await writeFile(join(dir, 'support.md'), '# Support\n\nSupport answers within 4 hours.\n')
    return dir
}

/** The top-level files of a folder, hidden ones skipped. */
async function filesIn(dir: string): Promise<File[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    return Promise.all(
        entries
            .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
            .map(async (entry) => new File([await readFile(join(dir, entry.name))], entry.name)),
    )
}

await using client = makeClient()
const dir = process.argv[2] ?? (await demoFolder())

let source = await client.sources.create(await filesIn(dir), { name: 'SDK example' })
console.log(`source ${source.pid} (id ${source.id}): ${source.status}`)

try {
    try {
        source = await client.sources.waitSynced(source.pid, { timeout: 300_000 })
    } catch (error) {
        if (error instanceof SourceSyncFailed) {
            console.error(`sync stopped in '${error.source.status}'`)
            process.exit(1)
        }
        throw error
    }
    console.log(`synced: ${source.documents_synced} documents`)
    for (const file of await client.sources.listFiles(source.pid)) {
        console.log(`  ${file.name}  ${file.size} bytes`)
    }

    const agent = await client.agents.create({
        name: 'SDK example: docs assistant',
        instructions: 'Answer only from the indexed documents.',
        capabilities: { indexedDocuments: { activation: 'always', sourceIds: [source.id] } },
    })
    try {
        // The chat must run as the key's owner to see the source.
        await using owner = new Cominty({ userId: agent.owner })
        const run = await owner.chat.start({
            agentId: agent.id,
            message: 'How much is the Pro plan, and how fast does support answer?',
        })
        console.log(`\n${await run.text()}`)
    } finally {
        await client.agents.delete(agent.id)
    }
} finally {
    await client.sources.archive(source.pid)
    if (!process.argv[2]) await rm(dir, { recursive: true, force: true })
    console.log('\narchived')
}
