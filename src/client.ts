/** The client — the one object you construct. */

import { type ComintyOptions, resolveConfig } from './config.ts'
import { validateUserId } from './models/chat.ts'
import { ChatResource } from './resources/chat.ts'
import { ThreadsResource } from './resources/threads.ts'
import { Transport } from './transport.ts'

/**
 * Client for the Cominty API.
 *
 * `userId` identifies the end user every call acts on behalf of. It is set once
 * here (or via `COMINTY_USER_ID`) and applied to every request, so resource
 * methods never take it.
 *
 * Construct once and reuse:
 *
 * ```ts
 * const client = new Cominty()            // reads COMINTY_API_KEY + COMINTY_USER_ID
 * const run = await client.chat.start({ agentId: 'agt_1', message: 'Hello' })
 * for await (const event of run) console.log(event.name, event.status)
 * console.log(await run.text())
 * ```
 *
 * It holds no persistent connection, so closing is optional — but `close()`
 * aborts anything still in flight, and `await using` does it for you:
 *
 * ```ts
 * await using client = new Cominty()
 * ```
 */
export class Cominty {
    readonly chat: ChatResource
    readonly threads: ThreadsResource

    readonly #transport: Transport
    readonly #userId: string
    readonly #baseUrl: string

    constructor(options: ComintyOptions = {}) {
        const config = resolveConfig(options)

        // Fail fast on a malformed user id instead of as a server 400/404 later.
        try {
            validateUserId(config.userId)
        } catch (cause) {
            throw new Error(`invalid userId: ${(cause as Error).message}`)
        }

        this.#userId = config.userId
        this.#baseUrl = config.baseUrl
        this.#transport = new Transport(config)
        this.chat = new ChatResource(this.#transport, config.userId)
        this.threads = new ThreadsResource(this.#transport, config.userId)
    }

    /** The end-user id every request is made on behalf of. */
    get userId(): string {
        return this.#userId
    }

    /** The resolved API base URL this client talks to. */
    get baseUrl(): string {
        return this.#baseUrl
    }

    /** Abort every in-flight request and stream. */
    close(): void {
        this.#transport.close()
    }

    async [Symbol.asyncDispose](): Promise<void> {
        this.close()
    }
}
