/**
 * The short version: ask, wait, print.
 *
 *   node examples/02-await-result.ts
 */

import { AGENT_ID, makeClient } from './_shared.ts'

await using client = makeClient()

const run = await client.chat.start({ agentId: AGENT_ID, message: 'Give me one fun fact.' })
console.log(await run.text())

// The full message carries more than the text.
const message = await run.result()
console.log(`\nstatus: ${message.status} · files: ${message.files.length}`)
