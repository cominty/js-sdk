/**
 * List and search the user's threads.
 *
 *   node examples/05-list-threads.ts
 */

import { makeClient } from './_shared.ts'

await using client = makeClient()

const threads = await client.threads.list({ limit: 20 })
console.log(`${threads.length} thread(s):\n`)
for (const thread of threads) {
    console.log(`  ${thread.created_at}  ${thread.starred ? '★' : ' '}  ${thread.name}`)
    console.log(`  ${thread.id}  via ${thread.agent.name}\n`)
}

// Free-text search, and zero-based pagination.
const matches = await client.threads.list({ terms: ['invoice'] })
console.log(`"invoice" matched ${matches.length} thread(s)`)

const page2 = await client.threads.list({ limit: 10, page: 1 })
console.log(`page 2 holds ${page2.length} thread(s)`)
