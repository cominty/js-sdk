/**
 * Read, rename, star and archive one thread.
 *
 *   node examples/06-manage-thread.ts
 */

import { AGENT_ID, makeClient } from './_shared.ts'

await using client = makeClient()

const run = await client.chat.start({
    agentId: AGENT_ID,
    message: 'Say hello.',
    name: 'Scratch thread',
})
await run.text()
const threadId = run.thread.id

const thread = await client.threads.get(threadId)
console.log(`"${thread.name}" — ${thread.messages.length} message(s)`)

// Partial update: only what you pass changes.
const renamed = await client.threads.update(threadId, { name: 'Renamed', starred: true })
console.log(`now "${renamed.name}", starred: ${renamed.starred}`)

await client.threads.archive(threadId)
console.log('archived')
