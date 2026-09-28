/** The threads resource: list, read, rename/star, and archive conversations. */

import type { Thread, ThreadSummary, UpdateThreadParams } from '../models/chat.ts'
import type { Transport } from '../transport.ts'

export interface ListThreadsParams {
    /** Page size. Defaults to 50; the API caps it at 100. */
    limit?: number
    /** Zero-based page index. */
    page?: number
    /** Free-text search terms. */
    terms?: string[]
    signal?: AbortSignal
}

export class ThreadsResource {
    readonly #transport: Transport
    readonly #userId: string

    constructor(transport: Transport, userId: string) {
        this.#transport = transport
        this.#userId = userId
    }

    /**
     * List the current user's threads, newest first.
     *
     * Returns lightweight summaries with no messages — call {@link get} to load a
     * thread's contents. Scoped to the client's `userId` automatically.
     */
    async list(params: ListThreadsParams = {}): Promise<ThreadSummary[]> {
        return await this.#transport.request<ThreadSummary[]>('GET', '/chat', {
            params: {
                user_id: this.#userId,
                limit: params.limit ?? 50,
                page: params.page ?? 0,
                terms: params.terms,
            },
            signal: params.signal,
        })
    }

    /** Fetch a single thread with its full message history. */
    async get(threadId: string, options: { signal?: AbortSignal } = {}): Promise<Thread> {
        return await this.#transport.request<Thread>(
            'GET',
            `/chat/${encodeURIComponent(threadId)}`,
            { signal: options.signal },
        )
    }

    /**
     * Rename and/or (un)star a thread.
     *
     * Partial: only the fields you pass are sent. Returns the updated thread as a
     * summary — this endpoint responds without the message history.
     */
    async update(threadId: string, params: UpdateThreadParams): Promise<ThreadSummary> {
        const body: Record<string, unknown> = {}
        if (params.name !== undefined) body.name = params.name
        if (params.starred !== undefined) body.starred = params.starred
        return await this.#transport.request<ThreadSummary>(
            'PUT',
            `/chat/${encodeURIComponent(threadId)}`,
            { json: body, signal: params.signal },
        )
    }

    /** Archive (soft-delete) a thread. */
    async archive(threadId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
        await this.#transport.request<unknown>('DELETE', `/chat/${encodeURIComponent(threadId)}`, {
            signal: options.signal,
        })
    }
}
