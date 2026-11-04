/**
 * List the MCP servers this key can use, and attach the enabled ones to an agent.
 *
 *   node examples/12-mcp-servers.ts
 */

import { makeClient } from './_shared.ts'

await using client = makeClient()

for (const server of await client.mcp.list({ enabled: null })) {
    const state = server.is_enabled ? 'on ' : 'off'
    const oauth = server.requires_oauth_connect ? '  (needs OAuth)' : ''
    console.log(`${state}  ${server.name.padEnd(20)} ${server.title}${oauth}`)
}

const enabled = await client.mcp.list()
if (enabled.length === 0) {
    console.log('\nNo MCP server is turned on for this key.')
    process.exit(0)
}

const agent = await client.agents.create({
    name: 'SDK example: MCP',
    capabilities: {
        mcp: { activation: 'always', connections: enabled.map((server) => server.name) },
    },
})
try {
    const run = await client.chat.start({
        agentId: agent.id,
        message: 'Which tools can you use? List them briefly.',
    })
    console.log(`\n${await run.text()}`)
} finally {
    await client.agents.delete(agent.id)
}
