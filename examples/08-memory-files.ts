/**
 * Keep memory files in a namespace, and start a thread that can use them.
 *
 *   node examples/08-memory-files.ts
 */

import { ConflictError } from '../src/index.ts'
import { AGENT_ID, makeClient } from './_shared.ts'

await using client = makeClient()

// A namespace is shared by the whole organization. Putting the user id in the
// name is what keeps one user's memory apart from another's.
const namespace = `sdk-example-${client.userId}`

const created = await client.memory.create({
    path: 'tone.md',
    namespace,
    purpose: 'writing style',
    content: 'Keep it casual.',
})
console.log(`created ${created.path} in "${created.namespace}"`)

try {
    // Summaries only — no content.
    for (const file of await client.memory.list({ namespace })) {
        console.log(`  ${file.updated_at}  ${file.path}  (${file.purpose})`)
    }
    console.log(`namespaces: ${(await client.memory.listNamespaces()).join(', ')}`)

    // Partial update: only what you pass changes. `version` comes from the last read.
    const updated = await client.memory.update('tone.md', {
        namespace,
        version: created.version,
        content: 'Keep it upbeat.',
    })
    console.log(`now: ${updated.content}`)

    // The file has moved on, so the first version is stale.
    try {
        await client.memory.update('tone.md', {
            namespace,
            version: created.version,
            purpose: 'tone of voice',
        })
    } catch (error) {
        if (!(error instanceof ConflictError)) throw error
        const fresh = await client.memory.get('tone.md', { namespace })
        console.log(`stale version refused; the current one is ${fresh.version}`)
    }

    // The namespace is fixed when the thread starts. Without one, a thread has no
    // memory unless its agent has a namespace of its own.
    const run = await client.chat.start({
        agentId: AGENT_ID,
        message: 'Check your memory: what tone should you write in?',
        memoryNamespace: namespace,
    })
    console.log(`\n${await run.text()}`)
} finally {
    await client.memory.delete('tone.md', { namespace })
    console.log('deleted')
}
