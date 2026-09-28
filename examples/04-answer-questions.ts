/**
 * Read the agent's clarifying questions and answer them.
 *
 *   node examples/04-answer-questions.ts
 */

import { AGENT_ID, makeClient } from './_shared.ts'

await using client = makeClient()

const run = await client.chat.start({ agentId: AGENT_ID, message: 'Book me a meeting room.' })
await run.text()

const questions = await run.questions()
if (questions.length === 0) {
    console.log('The agent answered outright:\n', await run.text())
} else {
    for (const question of questions) {
        console.log(`Q: ${question.prompt}`)
        for (const option of question.options) console.log(`   - ${option}`)
    }

    // The answer is just the next message — a chosen option, or free text.
    const answer = questions[0]?.options[0] ?? 'Tomorrow at 10am'
    const reply = await client.chat.send(run.thread.id, { agentId: AGENT_ID, message: answer })
    console.log(`\nA: ${answer}\n${await reply.text()}`)
}
