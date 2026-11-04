/**
 * Create, update and delete a custom agent.
 *
 *   node examples/10-agents.ts
 */

import { makeClient } from './_shared.ts'

await using client = makeClient()

for (const agent of await client.agents.list()) {
    console.log(`${agent.managed ? 'built-in' : agent.scope.padEnd(8)}  ${agent.id}  ${agent.name}`)
}

const models = await client.agents.listModels()
console.log(`\nmodels: ${models.map((m) => m.name).join(', ')}`)

let agent = await client.agents.create({
    name: 'SDK example: support',
    description: 'Answers support questions briefly',
    instructions: 'Be brief. Never browse the web.',
    capabilities: { web: { activation: 'never' } },
    modelIds: models.length > 0 ? [models[0]!.id] : undefined,
})
console.log(`\ncreated ${agent.id}, owned by ${agent.owner}`)

try {
    // Partial: only what you pass is sent. Capabilities merge key by key.
    agent = await client.agents.update(agent.id, {
        description: null,
        capabilities: { imageGeneration: { activation: 'on_request' } },
    })
    console.log('capabilities now:', agent.capabilities)

    if (models.length > 1) {
        agent = await client.agents.setModels(agent.id, {
            modelIds: [models[1]!.id, models[0]!.id],
        })
        console.log(`model chain: ${agent.models.map((m) => m.name).join(' -> ')}`)
    }

    const run = await client.chat.start({ agentId: agent.id, message: 'Who are you?' })
    console.log(`\n${await run.text()}`)
} finally {
    await client.agents.delete(agent.id)
    console.log('\ndeleted')
}
