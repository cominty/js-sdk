/** The chat resource: start a thread, stream the assistant's reply, and move files. */

import { InvalidParams, SDKError, type InvalidParam } from '../errors.ts'
import {
    buildChatBody,
    buildExportQuery,
    checkMessageId,
    liveAssistantMessage,
    type ConversationFile,
    type ExportMessageParams,
    type Message,
    type MessageParams,
    type StartChatParams,
    type Thread,
} from '../models/chat.ts'
import {
    checkFileId,
    prepareUpload,
    readUploadPermission,
    type UploadFileParams,
    type UploadSource,
} from '../models/files.ts'
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
     * `maxSteps` is per message: pass it again to keep a cap. `messageScope`
     * narrows the thread's capabilities for this message only. Neither
     * `threadCapabilities` nor `memoryNamespace` is taken here: a thread keeps the
     * ones it was started with, and passing them throws `InvalidParams`.
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

    /**
     * Cancel an assistant message that is still being generated.
     *
     * Sends `POST /chat/messages/{messageId}/cancel`. The status flips to
     * `cancelled` right away, and whatever the agent produced before that is kept
     * in `events`. Not idempotent: a message that already finished, failed or was
     * cancelled throws an `APIError` (400, "Message is not live"), so a stop
     * button should read that as "too late". An unknown message throws
     * `NotFoundError`.
     *
     * ```ts
     * const message = await client.chat.cancel(run.messageId)
     * console.log(message.status) // 'cancelled'
     * ```
     */
    async cancel(messageId: string, options: { signal?: AbortSignal } = {}): Promise<Message> {
        const errors: InvalidParam[] = []
        checkMessageId(errors, messageId)
        if (errors.length > 0) throw new InvalidParams('chat.cancel', errors)
        return this.#transport.request<Message>('POST', `/chat/messages/${messageId}/cancel`, {
            signal: options.signal,
        })
    }

    /**
     * Export a finished message as a document, and return the file's bytes.
     *
     * Sends `GET /chat/messages/{messageId}/export`. The server renders the
     * message's content (Markdown) as a PDF or a DOCX file. No file name comes
     * back: pick one when you write the bytes. A message with no content, for
     * instance one still running, throws an `APIError` (400, "Message has no
     * content").
     *
     * ```ts
     * const pdf = await client.chat.export(reply.id, { format: 'pdf' })
     * await writeFile('brief.pdf', pdf)
     * ```
     */
    async export(messageId: string, params: ExportMessageParams): Promise<Uint8Array> {
        const query = buildExportQuery(messageId, params)
        return this.#transport.requestBytes('GET', `/chat/messages/${messageId}/export`, {
            params: query,
            signal: params.signal,
        })
    }

    /**
     * Upload a file so a message can use it through `fileIds`.
     *
     * Runs the whole presigned upload: `GET /chat/files/upload` asks for a
     * permission, the bytes go straight to the storage backend (which never sees
     * your API key), then `POST /chat/files` confirms the upload. Pass the
     * returned `id` in `fileIds` of `start` or `send` (5 files per message at
     * most).
     *
     * A file is at most 500 MiB, checked before anything is sent. The server also
     * caps the uploads per day per organization, and another deployment may set a
     * lower size limit: such a refusal throws an `APIError` with the storage
     * reason. In a browser, the storage bucket must expose the `ETag` header to
     * your origin (CORS), or the upload cannot be confirmed.
     *
     * ```ts
     * const report = await client.chat.uploadFile(await openAsBlob('q3.pdf'), { filename: 'q3.pdf' })
     * const data = await client.chat.uploadFile(new TextEncoder().encode('a,b\n1,2\n'), {
     *     filename: 'data.csv',
     * })
     * await client.chat.start({ agentId, message: 'Compare them.', fileIds: [report.id, data.id] })
     * ```
     */
    async uploadFile(file: UploadSource, params: UploadFileParams = {}): Promise<ConversationFile> {
        const upload = prepareUpload(file, params)
        const signal = params.signal

        const permission = readUploadPermission(
            await this.#transport.request<unknown>('GET', '/chat/files/upload', {
                params: { filename: upload.filename, mimetype: upload.mimetype },
                signal,
            }),
        )
        // The presigned fields first: S3 ignores any field after the file.
        const form = new FormData()
        for (const [name, value] of Object.entries(permission.fields)) form.append(name, value)
        form.append('file', upload.blob, upload.filename)
        const etag = await this.#transport.uploadToPresignedUrl(permission.url, form, signal)

        return this.#transport.request<ConversationFile>('POST', '/chat/files', {
            json: { etag, key: permission.key },
            signal,
        })
    }

    /**
     * Download the content of a conversation file.
     *
     * Sends `GET /chat/files/{fileId}`, which answers with a short-lived presigned
     * URL (5 minutes), then fetches the bytes from it without your API key. Works
     * for files you uploaded and files the agent produced. Not scoped to the
     * client's `userId`: any file created through the API in the same
     * organization can be downloaded. The whole file is held in memory.
     *
     * ```ts
     * for (const file of reply.files) {
     *     // Keep only the last path segment: file names are not under your control.
     *     await writeFile(basename(file.name), await client.chat.downloadFile(file.id))
     * }
     * ```
     */
    async downloadFile(
        fileId: string,
        options: { signal?: AbortSignal } = {},
    ): Promise<Uint8Array> {
        checkFileId(fileId)
        const url = await this.#transport.request<unknown>(
            'GET',
            `/chat/files/${encodeURIComponent(fileId)}`,
            { signal: options.signal },
        )
        if (typeof url !== 'string') {
            throw new SDKError(
                `GET /chat/files/${fileId} did not answer with a download URL string`,
            )
        }
        return this.#transport.downloadFromPresignedUrl(url, options.signal)
    }
}
