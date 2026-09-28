/**
 * The streaming handle returned by the chat resource.
 *
 * `AssistantRun` wraps a started assistant message: it carries the thread and
 * message id the POST already returned, and opens the JSONL stream lazily, when
 * you consume it. Iterating yields progress *events* only; the terminal message
 * is captured internally and returned by `result()` / `text()`.
 *
 * This is where wire lines are *classified* — events vs the terminal message
 * snapshot vs a server-shutdown partial — domain knowledge the transport
 * deliberately does not have.
 */

import { type AnyEvent, parseEvent } from './events.ts'
import { SDKError, StreamInterrupted } from './errors.ts'
import type { Message, Question, Thread } from './models/chat.ts'
import type { Transport } from './transport.ts'

const SHUTDOWN_KEY = '__server_is_shutting_down'

export interface AssistantRunInit {
    thread?: Thread
    lastEventId?: string
    signal?: AbortSignal
}

/**
 * A live assistant message you can stream, or just await the result of.
 *
 * The stream is single-use: consume it once, either by iterating events or by
 * calling `result()` / `text()`. Calling `text()` *after* iterating is free — the
 * terminal message is cached.
 */
export class AssistantRun implements AsyncIterable<AnyEvent> {
    readonly #transport: Transport
    readonly #messageId: string
    readonly #signal: AbortSignal | undefined
    protected _thread: Thread | undefined

    #lastEventId: string | undefined
    #terminal: Message | undefined
    #consumed = false
    #iterator: AsyncGenerator<AnyEvent> | undefined

    constructor(transport: Transport, messageId: string, init: AssistantRunInit = {}) {
        this.#transport = transport
        this.#messageId = messageId
        this._thread = init.thread
        this.#lastEventId = init.lastEventId
        this.#signal = init.signal
    }

    /** The id of the assistant message being streamed. */
    get messageId(): string {
        return this.#messageId
    }

    /**
     * The thread from the originating `start` call, if any. `undefined` for a
     * bare `chat.stream(messageId)` or a `chat.send` follow-up — in both cases
     * you already hold the thread id.
     */
    get thread(): Thread | undefined {
        return this._thread
    }

    /** The last event id seen, for resuming a dropped stream. */
    get lastEventId(): string | undefined {
        return this.#lastEventId
    }

    [Symbol.asyncIterator](): AsyncIterator<AnyEvent> {
        // Re-iterating an exhausted generator would silently yield nothing, which
        // reads as "the agent said nothing". Say what actually happened instead.
        if (this.#iterator) return this.#alreadyConsumed()
        this.#iterator = this.#stream()
        return this.#iterator
    }

    /** An iterator that rejects on the first pull, rather than yielding nothing. */
    #alreadyConsumed(): AsyncIterator<AnyEvent> {
        return {
            next: () =>
                Promise.reject(new SDKError('this AssistantRun stream has already been consumed')),
        }
    }

    async *#stream(): AsyncGenerator<AnyEvent> {
        if (this.#consumed) throw new SDKError('this AssistantRun stream has already been consumed')
        this.#consumed = true

        const headers: Record<string, string> = {}
        // Resume from where a previous attempt left off; omit to start at the top.
        if (this.#lastEventId !== undefined) headers['last-event-id'] = this.#lastEventId

        const path = `/chat/messages/${encodeURIComponent(this.#messageId)}/stream`
        for await (const obj of this.#transport.streamLines('GET', path, {
            headers,
            signal: this.#signal,
        })) {
            if (SHUTDOWN_KEY in obj) {
                const partial = obj.partial as Message
                this.#terminal = partial
                throw new StreamInterrupted(
                    'server shut down before the message completed',
                    partial,
                )
            }
            if ('correlation_id' in obj) {
                const event = parseEvent(obj)
                this.#lastEventId = event.id
                yield event
                continue
            }
            // No correlation_id and not a shutdown envelope: the terminal message
            // snapshot. The `result` event is NOT what ends the stream — this is.
            this.#terminal = obj as unknown as Message
            return
        }
    }

    /**
     * Drain the stream if needed and return the final message.
     *
     * Throws {@link StreamInterrupted} if the server shut down mid-stream.
     */
    async result(): Promise<Message> {
        if (this.#terminal !== undefined) return this.#terminal
        if (this.#consumed) {
            throw new SDKError('stream was partially consumed; the final message is unavailable')
        }
        for await (const _ of this) {
            // Drain: the terminal message is captured as a side effect.
        }
        if (this.#terminal === undefined) {
            throw new SDKError('stream ended without a terminal message')
        }
        return this.#terminal
    }

    /** The assistant's final reply text. */
    async text(): Promise<string> {
        return (await this.result()).content
    }

    /**
     * Clarifying questions the agent is asking, if any.
     *
     * When an agent needs more input it ends its turn with questions (a `prompt`
     * plus suggested `options`) instead of a final answer. Answer by sending the
     * chosen option — or free text — as the next message via `chat.send`. An
     * empty array means the agent gave a final answer.
     */
    async questions(): Promise<Question[]> {
        return (await this.result()).questions ?? []
    }

    /** Stop consuming and release the connection. */
    async close(): Promise<void> {
        await this.#iterator?.return(undefined as never)
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close()
    }
}

/**
 * The run returned by `chat.start`.
 *
 * Identical to {@link AssistantRun}, but `thread` is guaranteed present (the
 * originating `POST /chat` always returns one), so callers don't have to guard.
 */
export class StartedChat extends AssistantRun {
    override get thread(): Thread {
        if (this._thread === undefined) {
            throw new SDKError('StartedChat was constructed without a thread')
        }
        return this._thread
    }
}
