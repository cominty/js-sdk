/** The memory resource: the files an agent can read and write, by namespace. */

import {
    buildCreateBody,
    buildFileQuery,
    buildListQuery,
    buildUpdate,
    type CreateMemoryFileParams,
    type ListMemoryFilesParams,
    type MemoryFile,
    type MemoryFileSummary,
    type UpdateMemoryFileParams,
} from '../models/memory.ts'
import type { Transport } from '../transport.ts'

export class MemoryResource {
    readonly #transport: Transport

    // No `userId`: memory belongs to a namespace, not to a user.
    constructor(transport: Transport) {
        this.#transport = transport
    }

    /**
     * List memory files, most recently updated first.
     *
     * Returns summaries with no `content` — call {@link get} to read a file. Leave
     * `namespace` out to list every file the API key can see; the same path can
     * then appear once per namespace.
     */
    async list(params: ListMemoryFilesParams = {}): Promise<MemoryFileSummary[]> {
        const query = buildListQuery(params)
        return await this.#transport.request<MemoryFileSummary[]>('GET', '/memory', {
            params: query,
            signal: params.signal,
        })
    }

    /**
     * List the namespaces that hold at least one file, in no particular order.
     *
     * There is no call to create or delete a namespace: its first file creates
     * it, and deleting its last file removes it from this list.
     */
    async listNamespaces(options: { signal?: AbortSignal } = {}): Promise<string[]> {
        return await this.#transport.request<string[]>('GET', '/memory/namespaces', {
            signal: options.signal,
        })
    }

    /**
     * Create a memory file in a namespace.
     *
     * Throws `ConflictError` if the path already exists in that namespace.
     *
     * ```ts
     * const file = await client.memory.create({
     *     path: 'tone.md',
     *     namespace: 'brand-voice',
     *     purpose: 'writing style',
     *     content: 'Keep it casual.',
     * })
     * ```
     */
    async create(params: CreateMemoryFileParams): Promise<MemoryFile> {
        const body = buildCreateBody(params)
        return await this.#transport.request<MemoryFile>('POST', '/memory', {
            json: body,
            signal: params.signal,
        })
    }

    /** Fetch one memory file, with its content. */
    async get(
        path: string,
        options: { namespace: string; signal?: AbortSignal },
    ): Promise<MemoryFile> {
        const query = buildFileQuery(path, options, 'memory.get')
        return await this.#transport.request<MemoryFile>('GET', '/memory/file', {
            params: query,
            signal: options.signal,
        })
    }

    /**
     * Change a memory file's content and/or purpose.
     *
     * Partial: only the fields you pass are sent, and at least one is needed.
     * `version` is the one from your last read of the file; a stale one throws
     * `ConflictError`. A field cannot be cleared, so `null` is rejected.
     */
    async update(path: string, params: UpdateMemoryFileParams): Promise<MemoryFile> {
        const { query, body } = buildUpdate(path, params)
        return await this.#transport.request<MemoryFile>('PUT', '/memory/file', {
            params: query,
            json: body,
            signal: params.signal,
        })
    }

    /**
     * Delete a memory file.
     *
     * Not idempotent: deleting a path that is already gone throws `NotFoundError`.
     */
    async delete(
        path: string,
        options: { namespace: string; signal?: AbortSignal },
    ): Promise<void> {
        const query = buildFileQuery(path, options, 'memory.delete')
        await this.#transport.request<unknown>('DELETE', '/memory/file', {
            params: query,
            signal: options.signal,
        })
    }
}
