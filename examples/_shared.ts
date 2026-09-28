/** Shared setup for the examples. */

import { Cominty } from '../src/index.ts'

/** The built-in general-purpose chat agent. Swap for one of your own. */
export const AGENT_ID = process.env.COMINTY_AGENT_ID ?? '__cominty_agents::agent.chat'

/** Reads COMINTY_API_KEY and COMINTY_USER_ID from the environment. */
export function makeClient(): Cominty {
    try {
        return new Cominty()
    } catch (error) {
        console.error(`\n${(error as Error).message}\n`)
        process.exit(1)
    }
}
