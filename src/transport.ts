/**
 * Low-level HTTP transport.
 *
 * The dumb bottom layer: it knows the auth header, JSON request/response, error
 * mapping, and JSONL stream framing — and nothing about threads, messages, or
 * events. Resource code builds requests and parses responses; it never touches
 * `fetch` directly.
 */

import type { ResolvedConfig } from './config.ts'
import { APIConnectionError, ComintyError, SDKError, errorFromResponse } from './errors.ts'

const TOKEN_HEADER = 'x-cominty-token'

export interface RequestOptions {
    json?: unknown
    params?: Record<string, unknown>
    headers?: Record<string, string>
    signal?: AbortSignal
}

export class Transport {
    readonly #config: ResolvedConfig
    /** Every in-flight request, so `close()` can abort them. */
    readonly #inflight = new Set<AbortController>()
    #closed = false

    constructor(config: ResolvedConfig) {
        this.#config = config
    }

    get baseUrl(): string {
        return this.#config.baseUrl
    }

    /**
     * Send a request and return the decoded JSON body.
     *
     * Throws an {@link APIError} subclass on 4xx/5xx, and
     * {@link APIConnectionError} when no response arrives.
     */
    async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
        const { controller, cleanup } = this.#controller(options.signal, this.#config.timeout)
        let response: Response
        try {
            response = await this.#config.fetch(this.#url(path, options.params), {
                method,
                headers: this.#headers(options.json !== undefined, options.headers),
                body: options.json === undefined ? undefined : JSON.stringify(options.json),
                signal: controller.signal,
            })
        } catch (cause) {
            throw this.#connectionError(cause, options.signal, path, 'Request to')
        } finally {
            cleanup()
        }

        const body = await safeJson(response)
        if (!response.ok) throw errorFromResponse(response.status, body, response.headers)
        return body as T
    }

    /**
     * Open a streaming response and yield each decoded JSONL object.
     *
     * Four framing rules the wire actually requires:
     *
     * 1. A bare JSON string line `"heartbeat"` appears during long idle steps —
     *    only objects are yielded, so it is skipped.
     * 2. **The final line may arrive with no trailing newline**, so the buffer is
     *    flushed and parsed after the reader drains.
     * 3. Non-JSON keep-alive lines are tolerated rather than killing the stream.
     * 4. No overall timeout — a run can legitimately take minutes. Pass a
     *    `signal` to bound it.
     */
    async *streamLines(
        method: string,
        path: string,
        options: RequestOptions = {},
    ): AsyncGenerator<Record<string, unknown>> {
        const { controller, cleanup } = this.#controller(options.signal)
        let response: Response
        try {
            response = await this.#config.fetch(this.#url(path, options.params), {
                method,
                headers: this.#headers(false, options.headers),
                signal: controller.signal,
            })
        } catch (cause) {
            cleanup()
            throw this.#connectionError(cause, options.signal, path, 'Stream to')
        }

        try {
            if (!response.ok) {
                throw errorFromResponse(response.status, await safeJson(response), response.headers)
            }
            if (!response.body) {
                throw new APIConnectionError(`Stream to ${path} returned no body`)
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split('\n')
                    // The last element is a partial line; keep it for the next chunk.
                    buffer = lines.pop() ?? ''
                    for (const line of lines) {
                        const parsed = parseLine(line)
                        if (parsed) yield parsed
                    }
                }
                // Rule 2: the terminal message often has no trailing newline.
                buffer += decoder.decode()
                const last = parseLine(buffer)
                if (last) yield last
            } catch (cause) {
                // Only `reader.read()` can throw here: an abort, or the connection
                // dropping mid-stream.
                throw this.#connectionError(cause, options.signal, path, 'Stream to')
            } finally {
                await reader.cancel().catch(() => {})
            }
        } finally {
            cleanup()
        }
    }

    /**
     * Send a request and return the raw response body: for endpoints that answer
     * with a file rather than JSON. Errors are mapped as in {@link request}.
     */
    async requestBytes(
        method: string,
        path: string,
        options: RequestOptions = {},
    ): Promise<Uint8Array> {
        const init = {
            method,
            headers: this.#headers(false, { accept: '*/*', ...options.headers }),
        }
        return this.#exchange(
            this.#url(path, options.params),
            init,
            options.signal,
            ['Request to', path],
            async (response) => {
                if (!response.ok) {
                    throw errorFromResponse(
                        response.status,
                        await safeJson(response),
                        response.headers,
                    )
                }
                return new Uint8Array(await response.arrayBuffer())
            },
        )
    }

    /**
     * POST a multipart form to a presigned storage URL and return the `ETag` the
     * storage backend answered with.
     *
     * Sent with no header of ours: the API key must never reach the storage host.
     * The URL's query holds its signature, so errors name the URL without it.
     */
    async uploadToPresignedUrl(url: string, form: FormData, signal?: AbortSignal): Promise<string> {
        const init: RequestInit = { method: 'POST', body: form, redirect: 'manual' }
        return this.#exchange(
            url,
            init,
            signal,
            ['Upload to', withoutQuery(url)],
            async (response) => {
                await requireStorageSuccess(response)
                const etag = response.headers.get('etag')
                if (etag === null) {
                    throw new SDKError(
                        'the storage backend accepted the upload but sent no ETag header',
                    )
                }
                return etag
            },
        )
    }

    /** GET a presigned storage URL and return its bytes. No header of ours is sent. */
    async downloadFromPresignedUrl(url: string, signal?: AbortSignal): Promise<Uint8Array> {
        const init: RequestInit = { method: 'GET', redirect: 'manual' }
        return this.#exchange(
            url,
            init,
            signal,
            ['Download from', withoutQuery(url)],
            async (response) => {
                await requireStorageSuccess(response)
                return new Uint8Array(await response.arrayBuffer())
            },
        )
    }

    /** Abort every in-flight request. */
    close(): void {
        this.#closed = true
        for (const controller of this.#inflight) controller.abort()
        this.#inflight.clear()
    }

    #controller(
        signal: AbortSignal | undefined,
        timeout?: number,
    ): { controller: AbortController; cleanup: () => void } {
        const controller = new AbortController()
        if (this.#closed) controller.abort()
        if (signal) {
            if (signal.aborted) controller.abort(signal.reason)
            else
                signal.addEventListener('abort', () => controller.abort(signal.reason), {
                    once: true,
                })
        }
        const timer =
            timeout === undefined ? undefined : setTimeout(() => controller.abort(TIMEOUT), timeout)
        this.#inflight.add(controller)
        return {
            controller,
            cleanup: () => {
                if (timer !== undefined) clearTimeout(timer)
                this.#inflight.delete(controller)
            },
        }
    }

    /**
     * One fetch plus reading its body, both under the client's timeout. `read`
     * throws SDK errors as they are; anything else is a connection failure.
     */
    async #exchange<T>(
        url: string,
        init: RequestInit,
        signal: AbortSignal | undefined,
        [what, target]: [string, string],
        read: (response: Response) => Promise<T>,
    ): Promise<T> {
        const { controller, cleanup } = this.#controller(signal, this.#config.timeout)
        try {
            const response = await this.#config.fetch(url, { ...init, signal: controller.signal })
            return await read(response)
        } catch (cause) {
            if (cause instanceof ComintyError) throw cause
            throw this.#connectionError(cause, signal, target, what)
        } finally {
            cleanup()
        }
    }

    #headers(hasBody: boolean, extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            [TOKEN_HEADER]: this.#config.apiToken,
            accept: 'application/json',
            ...extra,
        }
        if (hasBody) headers['content-type'] = 'application/json'
        return headers
    }

    #url(path: string, params?: Record<string, unknown>): string {
        const url = new URL(this.#config.baseUrl + path)
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value === undefined || value === null) continue
                // FastAPI expects repeated keys for array params (terms=a&terms=b),
                // not a bracketed or comma-joined form.
                if (Array.isArray(value)) {
                    for (const item of value) url.searchParams.append(key, String(item))
                } else {
                    url.searchParams.append(key, String(value))
                }
            }
        }
        return url.toString()
    }

    /** Turn an aborted/failed fetch into the error the caller deserves. */
    #connectionError(cause: unknown, signal: AbortSignal | undefined, path: string, what: string) {
        if (cause instanceof Error && cause.name === 'AbortError') {
            // The caller's own abort propagates unchanged; ours becomes a timeout.
            if (signal?.aborted) return cause
            if (this.#closed)
                return new APIConnectionError(`${what} ${path} was aborted: client closed`, cause)
            return new APIConnectionError(`${what} ${path} timed out`, cause)
        }
        const detail = cause instanceof Error ? cause.message : String(cause)
        return new APIConnectionError(`${what} ${path} failed: ${detail}`, cause)
    }
}

const TIMEOUT = new DOMException('Timed out', 'AbortError')

function parseLine(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        // Rule 3: tolerate a non-JSON keep-alive rather than killing the stream.
        return null
    }
    // Rule 1: `"heartbeat"` is a bare string, not an object.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
}

/** A presigned URL carries its signature in the query string: keep it out of errors. */
function withoutQuery(url: string): string {
    return url.split('?', 1)[0]!.split('#', 1)[0]!
}

/**
 * Throw unless the storage backend answered 2xx. A presigned URL cannot survive
 * a redirect, so redirects are not followed: a 3xx is a failure too.
 */
async function requireStorageSuccess(response: Response): Promise<void> {
    if (response.ok) return
    if (response.status >= 400) {
        const text = await response.text().catch(() => '')
        const body = parseJson(text) ?? storageErrorBody(text, response.headers)
        throw errorFromResponse(response.status, body, response.headers)
    }
    const body = { detail: 'the storage backend answered with a redirect instead of the file' }
    throw errorFromResponse(response.status, body, response.headers)
}

/** S3 answers errors with XML, not JSON: surface its Code and Message as the detail. */
function storageErrorBody(text: string, headers: Headers): { detail: string } | null {
    if (!(headers.get('content-type') ?? '').includes('xml')) return null
    const code = /<Code>(.*?)<\/Code>/s.exec(text)
    if (!code) return null
    const message = /<Message>(.*?)<\/Message>/s.exec(text)
    const detail = unescapeXml(code[1]!)
    return { detail: message ? `${detail}: ${unescapeXml(message[1]!)}` : detail }
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

/** The five XML entities; anything else is left as it is. */
function unescapeXml(value: string): string {
    return value.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => XML_ENTITIES[name]!)
}

function parseJson(text: string): unknown {
    try {
        return text ? JSON.parse(text) : null
    } catch {
        return null
    }
}

async function safeJson(response: Response): Promise<unknown> {
    try {
        const text = await response.text()
        return text ? JSON.parse(text) : null
    } catch {
        return null
    }
}
