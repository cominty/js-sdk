/**
 * Continue a conversation in the same thread.
 *
 *   node examples/03-follow-up.ts
 */

import { AGENT_ID, makeClient } from './_shared.ts'

await using client = makeClient()

const first = await client.chat.start({
    agentId: AGENT_ID,
    message: 'Pick a programming language — just the name.',
    name: 'Language picker',
})
console.log('1:', await first.text())

// `start` returns the thread; follow-ups only need its id.
const second = await client.chat.send(first.thread.id, {
    agentId: AGENT_ID,
    message: 'Now show hello-world in it.',
})
console.log('2:', await second.text())
