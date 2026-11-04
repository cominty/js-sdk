/** The sources resource: turn files into a document source an agent can search. */

import {
    InvalidParams,
    NotFoundError,
    SDKError,
    SourceSyncFailed,
    SourceSyncTimeout,
    type InvalidParam,
} from '../errors.ts'
import { checkFileId } from '../models/files.ts'
import { pathId } from '../models/common.ts'
import {
    buildCreateSourceBody,
    checkSourceName,
    prepareSourceFiles,
    sourceDriveId,
    type CreateSourceParams,
    type Drive,
    type Source,
    type SourceFile,
    type SourceFileInput,
    type SourceStatus,
    type UpdateSourceParams,
    type WaitSyncedParams,
} from '../models/sources.ts'
import type { PreparedUpload } from '../models/files.ts'
import type { Transport } from '../transport.ts'
import { presignedUpload } from '../uploads.ts'

type Operation = 'start' | 'pause' | 'archive' | 'sync'

/** `operation=sync` is only valid from these statuses. */
const SYNCABLE: ReadonlySet<SourceStatus> = new Set([
    'synced',
    'error',
    'out_of_sync',
    'daily_quota_reached',
])

/** A sync is still in flight, or about to start, in these statuses: keep waiting. */
const IN_PROGRESS: ReadonlySet<SourceStatus> = new Set([
    'pending',
    'syncing',
    'out_of_sync',
    'cancelling',
    'pausing',
])

const DEFAULT_WAIT_TIMEOUT_MS = 600_000
const DEFAULT_WAIT_INTERVAL_MS = 5_000

interface Options {
    signal?: AbortSignal
}

export class SourcesResource {
    readonly #transport: Transport

    // No `userId`: a source belongs to the API key's creator, not to the end user.
    constructor(transport: Transport) {
        this.#transport = transport
    }

    /**
     * Turn files into an indexed document source.
     *
     * One call runs the whole flow: `POST /drives` creates the container, every
     * file goes through the presigned upload (your API key never reaches the
     * storage backend), then `POST /dc/sources` creates a private drag-and-drop
     * source over the drive. Its first sync starts at once: await
     * {@link waitSynced} before searching it. Files are uploaded one after the
     * other.
     *
     * Every file is checked before anything is sent: a source holds at most 50
     * files, with unique names.
     *
     * Chats that search the source must run with the `userId` of the admin who
     * minted the API key (`owner` on any agent the key created). With another
     * `userId`, the agent's document tool finds no authorized source.
     *
     * ```ts
     * const source = await client.sources.create(
     *     [new File([await readFile('faq.md')], 'faq.md'), { filename: 'notes.txt', content: bytes }],
     *     { name: 'Product docs' },
     * )
     * await client.sources.waitSynced(source.pid)
     * ```
     */
    async create(
        files: SourceFileInput | readonly SourceFileInput[],
        params: CreateSourceParams = {},
    ): Promise<Source> {
        const context = 'sources.create'
        checkSourceName(params?.name, context, false)
        const uploads = prepareSourceFiles(files, context)
        const signal = params?.signal

        const drive = await this.#transport.request<Drive>('POST', '/drives', { signal })
        for (const upload of uploads) await this.#upload(drive.id, upload, signal)
        return this.#transport.request<Source>('POST', '/dc/sources', {
            json: buildCreateSourceBody({ name: params?.name }, drive.id),
            signal,
        })
    }

    /**
     * List the sources visible to this API key: the organization's, plus the ones
     * the key created, archived ones included.
     */
    async list(options: Options = {}): Promise<Source[]> {
        return this.#transport.request<Source[]>('GET', '/dc/sources', {
            signal: options.signal,
        })
    }

    /**
     * Fetch one source by public id.
     *
     * The API has no single-source read for keys, so this lists and picks: it
     * costs the same as {@link list}. Throws `NotFoundError` if no visible source
     * has this `pid`.
     */
    async get(sourcePid: string, options: Options = {}): Promise<Source> {
        pathId(sourcePid, 'sourcePid', 'sources.get')
        for (const source of await this.list(options)) {
            if (source.pid === sourcePid) return source
        }
        throw new NotFoundError(`no source with pid '${sourcePid}' is visible to this API key`, {
            status: 404,
            detail: 'Not Found',
        })
    }

    /** Rename a source. A drag-and-drop source's drive cannot change. */
    async update(sourcePid: string, params: UpdateSourceParams): Promise<Source> {
        const pid = pathId(sourcePid, 'sourcePid', 'sources.update')
        checkSourceName(params?.name, 'sources.update', true)
        return this.#transport.request<Source>('PUT', `/dc/sources/${pid}`, {
            json: { name: params.name },
            signal: params.signal,
        })
    }

    /**
     * Upload more files into a source and have it re-indexed.
     *
     * A sync is requested afterwards when the source accepts one (`synced`,
     * `error`, `out_of_sync`, `daily_quota_reached`); while a sync is already
     * running, the new files are left for it, or for the daily one, to pick up.
     * The 50-file cap counts the files already in the source. Files uploaded
     * before a failure stay in the source.
     */
    async addFiles(
        sourcePid: string,
        files: SourceFileInput | readonly SourceFileInput[],
        options: Options = {},
    ): Promise<SourceFile[]> {
        const context = 'sources.addFiles'
        pathId(sourcePid, 'sourcePid', context)
        // Checked once before any request, then again with the files already there.
        prepareSourceFiles(files, context)
        const signal = options.signal
        const source = await this.get(sourcePid, { signal })
        const drive = await this.#drive(source, signal)
        const uploads = prepareSourceFiles(files, context, drive.files.length)

        const added: SourceFile[] = []
        for (const upload of uploads) added.push(await this.#upload(drive.id, upload, signal))
        await this.#syncIfAllowed(source, signal)
        return added
    }

    /** List the files a source is built from. */
    async listFiles(sourcePid: string, options: Options = {}): Promise<SourceFile[]> {
        pathId(sourcePid, 'sourcePid', 'sources.listFiles')
        const source = await this.get(sourcePid, options)
        return (await this.#drive(source, options.signal)).files
    }

    /**
     * Remove a file from a source and have it re-indexed, under the same sync
     * rule as {@link addFiles}. Sends `DELETE /files/{fileId}`.
     */
    async removeFile(sourcePid: string, fileId: string, options: Options = {}): Promise<void> {
        pathId(sourcePid, 'sourcePid', 'sources.removeFile')
        const id = pathId(fileId, 'fileId', 'sources.removeFile')
        const source = await this.get(sourcePid, options)
        await this.#transport.request<unknown>('DELETE', `/files/${id}`, {
            signal: options.signal,
        })
        await this.#syncIfAllowed(source, options.signal)
    }

    /**
     * Download a file of a source.
     *
     * `GET /files/{fileId}` answers with a short-lived presigned URL (5 minutes);
     * the bytes are then fetched from it without your API key. The whole file is
     * held in memory.
     */
    async downloadFile(fileId: string, options: Options = {}): Promise<Uint8Array> {
        checkFileId(fileId, 'sources.downloadFile')
        const url = await this.#transport.request<unknown>(
            'GET',
            `/files/${encodeURIComponent(fileId)}`,
            { signal: options.signal },
        )
        if (typeof url !== 'string') {
            throw new SDKError(`GET /files/${fileId} did not answer with a download URL string`)
        }
        return this.#transport.downloadFromPresignedUrl(url, options.signal)
    }

    /** Resume a paused source. Only valid from `paused`. */
    async start(sourcePid: string, options: Options = {}): Promise<Source> {
        return this.#manage(sourcePid, 'start', options.signal)
    }

    /** Pause a source: no more syncs until {@link start}. A running sync is cancelled. */
    async pause(sourcePid: string, options: Options = {}): Promise<Source> {
        return this.#manage(sourcePid, 'pause', options.signal)
    }

    /**
     * Sync now instead of waiting for the daily sync. Valid from `synced`,
     * `error`, `out_of_sync` and `daily_quota_reached`.
     */
    async sync(sourcePid: string, options: Options = {}): Promise<Source> {
        return this.#manage(sourcePid, 'sync', options.signal)
    }

    /**
     * Archive a source and its drive. This is terminal: the indexed documents are
     * removed, and the source stays listed with `status: 'archived'`.
     */
    async archive(sourcePid: string, options: Options = {}): Promise<Source> {
        return this.#manage(sourcePid, 'archive', options.signal)
    }

    /**
     * Wait until a source has finished indexing.
     *
     * Reads the source every `interval` milliseconds while a sync is pending or
     * running, and returns it as soon as it is `synced`. Throws
     * `SourceSyncFailed` (with `.source`) when the source stops anywhere else
     * (`error`, `paused`, `archived`, `daily_quota_reached`, ...), and
     * `SourceSyncTimeout` once `timeout` has elapsed. Your own `signal` aborts the
     * wait with its reason.
     *
     * ```ts
     * const ready = await client.sources.waitSynced(source.pid, { timeout: 120_000 })
     * ```
     */
    async waitSynced(sourcePid: string, params: WaitSyncedParams = {}): Promise<Source> {
        pathId(sourcePid, 'sourcePid', 'sources.waitSynced')
        const timeout = params?.timeout ?? DEFAULT_WAIT_TIMEOUT_MS
        const interval = params?.interval ?? DEFAULT_WAIT_INTERVAL_MS
        const errors: InvalidParam[] = []
        for (const [param, value] of [
            ['timeout', timeout],
            ['interval', interval],
        ] as const) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                errors.push({
                    param,
                    message: 'must be a non-negative number of milliseconds',
                    input: value,
                })
            }
        }
        if (errors.length > 0) throw new InvalidParams('sources.waitSynced', errors)
        const outer = params?.signal
        outer?.throwIfAborted()

        const controller = new AbortController()
        const onAbort = () => controller.abort(outer!.reason)
        outer?.addEventListener('abort', onAbort, { once: true })
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            controller.abort(new DOMException('Timed out', 'AbortError'))
        }, timeout)

        let last: Source | null = null
        try {
            while (true) {
                last = await this.get(sourcePid, { signal: controller.signal })
                if (last.status === 'synced') return last
                if (!IN_PROGRESS.has(last.status)) {
                    throw new SourceSyncFailed(
                        `source '${sourcePid}' stopped in status '${last.status}' instead of reaching 'synced'`,
                        last,
                    )
                }
                await sleep(interval, controller.signal)
            }
        } catch (error) {
            if (timedOut && !(error instanceof SourceSyncFailed)) {
                throw new SourceSyncTimeout(
                    `source '${sourcePid}' was not synced after ${timeout} ms` +
                        (last ? ` (last status '${last.status}')` : ''),
                    last,
                )
            }
            throw error
        } finally {
            clearTimeout(timer)
            outer?.removeEventListener('abort', onAbort)
        }
    }

    async #manage(
        sourcePid: string,
        operation: Operation,
        signal: AbortSignal | undefined,
    ): Promise<Source> {
        const pid = pathId(sourcePid, 'sourcePid', `sources.${operation}`)
        return this.#transport.request<Source>('PUT', `/dc/sources/${pid}/status`, {
            params: { operation },
            signal,
        })
    }

    async #syncIfAllowed(source: Source, signal: AbortSignal | undefined): Promise<void> {
        if (SYNCABLE.has(source.status)) await this.#manage(source.pid, 'sync', signal)
    }

    async #drive(source: Source, signal: AbortSignal | undefined): Promise<Drive> {
        const driveId = sourceDriveId(source)
        if (driveId === null) {
            throw new SDKError(
                `source '${source.pid}' (${source.store}) has no drive_id in its config: ` +
                    'only drag-and-drop sources hold files',
            )
        }
        return this.#transport.request<Drive>('GET', `/drives/${encodeURIComponent(driveId)}`, {
            signal,
        })
    }

    async #upload(
        driveId: string,
        upload: PreparedUpload,
        signal: AbortSignal | undefined,
    ): Promise<SourceFile> {
        const drive = encodeURIComponent(driveId)
        return presignedUpload<SourceFile>(
            this.#transport,
            upload,
            { permission: `/drives/${drive}/upload`, confirm: '/drives/upload' },
            signal,
        )
    }
}

/** Resolve after `ms`, or reject with the signal's reason as soon as it aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason)
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal.reason)
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
    })
}
