/**
 * Stream an agent's progress live.
 *
 *   node examples/01-stream-events.ts
 */

import { isKnownEvent } from '../src/index.ts'
import { AGENT_ID, makeClient } from './_shared.ts'

const client = makeClient()

const run = await client.chat.start({
    agentId: AGENT_ID,
    message: 'Research the history of the espresso machine and summarise it in three lines.',
})

for await (const event of run) {
    // Removes the forward-compat UnknownEvent member, so the switch below narrows
    // to each event's real `data` type.
    if (!isKnownEvent(event)) {
        console.log(`event    ${event.name} ${event.status}  (unknown to this SDK version)`)
        continue
    }

    switch (event.name) {
        case 'waiting_for_start':
            console.log('queued…')
            break
        case 'setting_up_sandbox':
            console.log(`sandbox  ${event.status}`)
            break
        case 'llm':
            console.log(`llm      ${event.data.description}  (${event.data.model})`)
            break
        case 'tool_call':
            console.log(`tool     ${event.data.name} -> ${event.status}`)
            break
        case 'intermediary_update':
            console.log(`note     ${event.data.message}`)
            break
        case 'result':
            console.log(
                `cost     ${event.data.cost.total}  ` +
                    `(${event.data.cost.input_tokens} in / ${event.data.cost.output_tokens} out)`,
            )
            break
    }
}

console.log(`\n${await run.text()}`)
client.close()
