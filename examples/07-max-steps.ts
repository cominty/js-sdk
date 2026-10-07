/**
 * Cap the agent's tool rounds for one message, then let it carry on.
 *
 *   node examples/07-max-steps.ts
 */

import { AGENT_ID, makeClient } from './_shared.ts'

await using client = makeClient()

// One round is one call to the model plus the tools it picks.
const run = await client.chat.start({
    agentId: AGENT_ID,
    message: 'Research the history of the espresso machine, then write it up.',
    maxSteps: 2,
})

// Reaching the cap is not an error, and nothing flags it: the agent recaps and
// asks whether to go on, and the message ends like any other.
const message = await run.result()
console.log(`status: ${message.status}\n${message.content}\n`)

// The cap is per message. Pass it again, or the server default applies.
const reply = await client.chat.send(run.thread.id, {
    agentId: AGENT_ID,
    message: 'Yes, continue.',
    maxSteps: 10,
})
console.log(await reply.text())
