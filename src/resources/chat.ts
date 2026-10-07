/** The chat resource: start a thread and stream the assistant's reply. */

import {
    buildChatBody,
    liveAssistantMessage,
    type Message,
    type MessageParams,
    type StartChatParams,
    type Thread,
} from '../models/chat.ts'
import { AssistantRun, StartedChat } from '../streaming.ts'
import type { Transport } from '../transport.ts'

export class ChatResource {
    readonly #transport: Transport
    readonly #userId: string

    constructor(transport: Transport, userId: string) {
        this.#transport = transport
        this.#userId = userId
    }

    /**
     * Start a new thread with a first user message.
     *
     * Sends `POST /chat`, then returns a run bound to the in-progress assistant
     * reply. Iterate it for progress events, or `await run.text()` for the final
     * answer.
     *
     * ```ts
     * const run = await client.chat.start({ agentId, message: 'What is Cominty?' })
     * console.log(await run.text())
     * ```
     */
    async start(params: StartChatParams): Promise<StartedChat> {
        const body = buildChatBody(params, this.#userId, 'chat.start')
        const thread = await this.#transport.request<Thread>('POST', '/chat', {
            json: body,
            signal: params.signal,
        })
        const reply = liveAssistantMessage(thread)
        return new StartedChat(this.#transport, reply.id, { thread, signal: params.signal })
    }

    /**
     * Send a follow-up message in an existing thread.
     *
     * The mirror of {@link start} for an ongoing conversation. Use it to answer an
     * agent's questions too — pass the chosen option (or free text) as `message`.
     *
     * Unlike `start`, this endpoint returns the new assistant message directly
     * rather than the whole thread, so the returned run has no `.thread`; you
     * already hold the `threadId`, and `threads.get(threadId)` fetches the rest.
     *
     * `maxSteps` is per message: pass it again to keep a cap. `memoryNamespace` is
     * not taken here — a thread keeps the one it was started with.
     */
    async send(threadId: string, params: MessageParams): Promise<AssistantRun> {
        const body = buildChatBody(params, this.#userId, 'chat.send')
        // `name` is a start-only concept; the wire rejects it here.
        delete (body as { name?: string }).name
        const reply = await this.#transport.request<Message>(
            'POST',
            `/chat/${encodeURIComponent(threadId)}`,
            { json: body, signal: params.signal },
        )
        return new AssistantRun(this.#transport, reply.id, { signal: params.signal })
    }

    /**
     * Stream an assistant message by id — no I/O until the run is consumed.
     *
     * Useful for reattaching to a run already in flight, or resuming one whose
     * stream dropped: pass the last event id you processed.
     */
    stream(
        messageId: string,
        options: { lastEventId?: string; signal?: AbortSignal } = {},
    ): AssistantRun {
        return new AssistantRun(this.#transport, messageId, options)
    }
}
