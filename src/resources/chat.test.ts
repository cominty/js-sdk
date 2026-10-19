import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import {
    APIConnectionError,
    APIError,
    InvalidParams,
    NotFoundError,
    PermissionError,
    SDKError,
} from '../errors.ts'
import type { StartChatParams } from '../models/chat.ts'
import { UPLOAD_MAX_BYTES } from '../models/files.ts'
import {
    AGENT_ID,
    assistantMessage,
    bytesResponse,
    conversationFile,
    jsonResponse,
    MESSAGE_ID,
    mockFetch,
    stalledResponse,
    startedThread,
    THREAD_ID,
    USER_ID,
} from '../test-utils.ts'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

describe('chat.start', () => {
    it('posts to /chat with the API-key header and the client user id', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hello' })

        const call = fetch.calls[0]!
        expect(call.method).toBe('POST')
        expect(call.url).toBe('https://ds.cominty.com/chat')
        expect(call.headers['x-cominty-token']).toBe('ck_live_test')
        expect(call.body).toEqual({
            message: { content: 'Hello' },
            options: { agent_id: AGENT_ID, user_id: USER_ID },
        })
    })

    it('maps camelCase arguments onto the snake_case wire', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({
            agentId: AGENT_ID,
            message: 'Hello',
            name: 'My thread',
            fileIds: ['f1'],
            sourceIds: [7],
            documentIds: ['d1'],
            disabledTools: ['web', 'mcp:slack'],
        })

        expect(fetch.calls[0]!.body).toEqual({
            name: 'My thread',
            message: {
                content: 'Hello',
                file_ids: ['f1'],
                source_ids: [7],
                document_ids: ['d1'],
                disabled_tools: ['web', 'mcp:slack'],
            },
            options: { agent_id: AGENT_ID, user_id: USER_ID },
        })
    })

    it('omits absent options rather than sending nulls', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hello' })
        expect(Object.keys(fetch.calls[0]!.body as object)).toEqual(['message', 'options'])
    })

    it('binds the run to the live assistant message in the thread', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        const run = await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hello' })
        expect(run.messageId).toBe(assistantMessage().id)
        expect(run.thread.id).toBe(THREAD_ID)
    })
})

describe('chat.start validation', () => {
    const noCall = mockFetch([])

    it('rejects a message over the length limit before any request', async () => {
        await expect(
            client(noCall).chat.start({ agentId: AGENT_ID, message: 'x'.repeat(30_001) }),
        ).rejects.toThrow(InvalidParams)
        expect(noCall.calls).toHaveLength(0)
    })

    it('rejects more than five files', async () => {
        await expect(
            client(noCall).chat.start({
                agentId: AGENT_ID,
                message: 'Hi',
                fileIds: ['1', '2', '3', '4', '5', '6'],
            }),
        ).rejects.toThrow(/at most 5/)
    })

    it('rejects a tool name that is neither built-in nor an MCP token', async () => {
        await expect(
            client(noCall).chat.start({
                agentId: AGENT_ID,
                message: 'Hi',
                disabledTools: ['nonsense' as 'web'],
            }),
        ).rejects.toThrow(/disabledTools\[0\]/)
    })

    it('accepts the MCP wildcard', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({
            agentId: AGENT_ID,
            message: 'Hi',
            disabledTools: ['mcp:*'],
        })
        expect(fetch.calls).toHaveLength(1)
    })

    it('names every offending argument at once', async () => {
        try {
            await client(noCall).chat.start({ agentId: '', message: 'Hi', fileIds: [1 as never] })
            expect.unreachable('should have thrown')
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidParams)
            const params = (error as InvalidParams).errors.map((e) => e.param)
            expect(params).toContain('agentId')
            expect(params).toContain('fileIds[0]')
        }
    })
})

describe('chat.send', () => {
    it('posts to /chat/{threadId} and returns a run with no thread', async () => {
        const fetch = mockFetch([jsonResponse(assistantMessage())])
        const run = await client(fetch).chat.send(THREAD_ID, {
            agentId: AGENT_ID,
            message: 'Follow up',
        })

        const call = fetch.calls[0]!
        expect(call.method).toBe('POST')
        expect(call.url).toBe(`https://ds.cominty.com/chat/${THREAD_ID}`)
        expect(call.body).toEqual({
            message: { content: 'Follow up' },
            options: { agent_id: AGENT_ID, user_id: USER_ID },
        })
        expect(run.thread).toBeUndefined()
    })

    it('validates the same way start does', async () => {
        const noCall = mockFetch([])
        await expect(
            client(noCall).chat.send(THREAD_ID, { agentId: AGENT_ID, message: 'x'.repeat(30_001) }),
        ).rejects.toThrow(InvalidParams)
    })
})

describe('maxSteps', () => {
    it('is sent as options.max_steps by start', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hello', maxSteps: 5 })
        expect(fetch.calls[0]!.body).toEqual({
            message: { content: 'Hello' },
            options: { agent_id: AGENT_ID, user_id: USER_ID, max_steps: 5 },
        })
    })

    it('is sent as options.max_steps by send', async () => {
        const fetch = mockFetch([jsonResponse(assistantMessage())])
        await client(fetch).chat.send(THREAD_ID, {
            agentId: AGENT_ID,
            message: 'Yes, continue.',
            maxSteps: 999,
        })
        expect(fetch.calls[0]!.body).toEqual({
            message: { content: 'Yes, continue.' },
            options: { agent_id: AGENT_ID, user_id: USER_ID, max_steps: 999 },
        })
    })

    it('accepts 1, the smallest cap', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hello', maxSteps: 1 })
        expect((fetch.calls[0]!.body as { options: object }).options).toHaveProperty('max_steps', 1)
    })

    it('is left out of the request when absent or undefined', async () => {
        const fetch = mockFetch([
            jsonResponse(startedThread()),
            jsonResponse(startedThread()),
            jsonResponse(assistantMessage()),
        ])
        const c = client(fetch)
        await c.chat.start({ agentId: AGENT_ID, message: 'Hello' })
        await c.chat.start({ agentId: AGENT_ID, message: 'Hello', maxSteps: undefined })
        await c.chat.send(THREAD_ID, { agentId: AGENT_ID, message: 'Hello', maxSteps: undefined })

        for (const call of fetch.calls) {
            const { options } = call.body as { options: object }
            expect(Object.keys(options)).toEqual(['agent_id', 'user_id'])
        }
    })

    const invalid: [string, unknown][] = [
        ['null', null],
        ['zero', 0],
        ['a negative integer', -3],
        ['a fraction', 2.5],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['a boolean', true],
        ['a string', '5'],
    ]

    it.each(invalid)('rejects %s on start, with no request sent', async (_label, value) => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.start({ agentId: AGENT_ID, message: 'Hi', maxSteps: value as number })
            .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(InvalidParams)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual(['maxSteps'])
        expect(noCall.calls).toHaveLength(0)
    })

    it.each(invalid)('rejects %s on send, with no request sent', async (_label, value) => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.send(THREAD_ID, { agentId: AGENT_ID, message: 'Hi', maxSteps: value as number })
            .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(InvalidParams)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual(['maxSteps'])
        expect(noCall.calls).toHaveLength(0)
    })

    it('says what it got, and how to ask for the server default', async () => {
        await expect(
            client(mockFetch([])).chat.start({
                agentId: AGENT_ID,
                message: 'Hi',
                maxSteps: Number.NaN,
            }),
        ).rejects.toThrow(
            'maxSteps: must be an integer >= 1, or left out for the server default (got NaN)',
        )
    })
})

describe('memoryNamespace', () => {
    it('is sent as options.memory_namespace by start', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).chat.start({
            agentId: AGENT_ID,
            message: 'Hello',
            maxSteps: 5,
            memoryNamespace: 'brand-voice',
        })
        expect(fetch.calls[0]!.body).toEqual({
            message: { content: 'Hello' },
            options: {
                agent_id: AGENT_ID,
                user_id: USER_ID,
                max_steps: 5,
                memory_namespace: 'brand-voice',
            },
        })
    })

    it('is left out, never sent as null, when not given', async () => {
        const fetch = mockFetch([jsonResponse(startedThread()), jsonResponse(startedThread())])
        const c = client(fetch)
        await c.chat.start({ agentId: AGENT_ID, message: 'Hello' })
        await c.chat.start({ agentId: AGENT_ID, message: 'Hello', memoryNamespace: undefined })

        for (const call of fetch.calls) {
            const { options } = call.body as { options: object }
            expect('memory_namespace' in options).toBe(false)
        }
    })

    it('is not trimmed, and an empty one is sent as given', async () => {
        const fetch = mockFetch([jsonResponse(startedThread()), jsonResponse(startedThread())])
        const c = client(fetch)
        await c.chat.start({ agentId: AGENT_ID, message: 'Hello', memoryNamespace: '  padded ' })
        await c.chat.start({ agentId: AGENT_ID, message: 'Hello', memoryNamespace: '' })

        const sent = fetch.calls.map(
            (call) => (call.body as { options: { memory_namespace: string } }).options,
        )
        expect(sent[0]!.memory_namespace).toBe('  padded ')
        expect(sent[1]!.memory_namespace).toBe('')
    })

    it('accepts 128 characters and rejects 129, before any request', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        const c = client(fetch)
        await c.chat.start({ agentId: AGENT_ID, message: 'Hi', memoryNamespace: 'n'.repeat(128) })
        expect(fetch.calls).toHaveLength(1)

        await expect(
            c.chat.start({ agentId: AGENT_ID, message: 'Hi', memoryNamespace: 'n'.repeat(129) }),
        ).rejects.toThrow('memoryNamespace: must be at most 128 characters, got 129')
        expect(fetch.calls).toHaveLength(1)
    })

    it('counts characters as the API does: an emoji is one, not two', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        const c = client(fetch)
        await c.chat.start({ agentId: AGENT_ID, message: 'Hi', memoryNamespace: '😀'.repeat(128) })
        expect(fetch.calls).toHaveLength(1)

        await expect(
            c.chat.start({ agentId: AGENT_ID, message: 'Hi', memoryNamespace: '😀'.repeat(129) }),
        ).rejects.toThrow(/got 129/)
    })

    it.each([
        ['null', null],
        ['a number', 7],
    ])('rejects %s, with no request sent', async (_label, value) => {
        const noCall = mockFetch([])
        await expect(
            client(noCall).chat.start({
                agentId: AGENT_ID,
                message: 'Hi',
                memoryNamespace: value as unknown as string,
            }),
        ).rejects.toThrow(/memoryNamespace: must be a string/)
        expect(noCall.calls).toHaveLength(0)
    })

    it('is refused by send: a thread keeps the namespace it was started with', async () => {
        const noCall = mockFetch([])
        await expect(
            client(noCall).chat.send(THREAD_ID, {
                agentId: AGENT_ID,
                message: 'Follow up',
                // @ts-expect-error -- the send params do not have it: the type refuses it too.
                memoryNamespace: 'brand-voice',
            }),
        ).rejects.toThrow(/memoryNamespace: .*keeps the namespace it was started with/)
        expect(noCall.calls).toHaveLength(0)
    })

    it('is refused by send even where TypeScript cannot see it', async () => {
        // Start params reused for the follow-up type-check, structurally.
        const params: StartChatParams = {
            agentId: AGENT_ID,
            message: 'Follow up',
            memoryNamespace: 'brand-voice',
            maxSteps: 0,
        }
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.send(THREAD_ID, params)
            .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(InvalidParams)
        // Named together with the other offending argument, in one pass.
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual([
            'maxSteps',
            'memoryNamespace',
        ])
        expect(noCall.calls).toHaveLength(0)
    })

    it('lets send through when it is explicitly undefined', async () => {
        const fetch = mockFetch([jsonResponse(assistantMessage())])
        const params: StartChatParams = {
            agentId: AGENT_ID,
            message: 'Follow up',
            memoryNamespace: undefined,
        }
        await client(fetch).chat.send(THREAD_ID, params)
        expect(fetch.calls[0]!.body).toEqual({
            message: { content: 'Follow up' },
            options: { agent_id: AGENT_ID, user_id: USER_ID },
        })
    })
})

describe('chat.cancel', () => {
    it('posts to /chat/messages/{id}/cancel and returns the cancelled message', async () => {
        const fetch = mockFetch([jsonResponse(assistantMessage({ status: 'cancelled' }))])
        const message = await client(fetch).chat.cancel(MESSAGE_ID)

        const call = fetch.calls[0]!
        expect(call.method).toBe('POST')
        expect(call.url).toBe(`https://ds.cominty.com/chat/messages/${MESSAGE_ID}/cancel`)
        expect(call.headers['x-cominty-token']).toBe('ck_live_test')
        expect(call.body).toBeUndefined()
        expect(message.status).toBe('cancelled')
    })

    it('rejects an id that is not a UUID, before any request', async () => {
        const noCall = mockFetch([])
        await expect(client(noCall).chat.cancel('not-a-uuid')).rejects.toThrow(
            'Invalid parameters for chat.cancel:\n  - messageId: must be a message UUID (got "not-a-uuid")',
        )
        expect(noCall.calls).toHaveLength(0)
    })

    it('surfaces "Message is not live" as an APIError with status 400', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'Message is not live' }, { status: 400 })])
        const error = await client(fetch)
            .chat.cancel(MESSAGE_ID)
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).status).toBe(400)
        expect((error as APIError).message).toBe('Message is not live')
    })

    it('surfaces an unknown message as NotFoundError', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'Not found' }, { status: 404 })])
        await expect(client(fetch).chat.cancel(MESSAGE_ID)).rejects.toThrow(NotFoundError)
    })
})

describe('chat.export', () => {
    it('gets /chat/messages/{id}/export?format= and returns the bytes', async () => {
        const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46])
        const fetch = mockFetch([
            bytesResponse(pdf, { headers: { 'content-type': 'application/pdf' } }),
        ])
        const bytes = await client(fetch).chat.export(MESSAGE_ID, { format: 'pdf' })

        const call = fetch.calls[0]!
        expect(call.method).toBe('GET')
        expect(call.url).toBe(
            `https://ds.cominty.com/chat/messages/${MESSAGE_ID}/export?format=pdf`,
        )
        expect(call.headers['x-cominty-token']).toBe('ck_live_test')
        expect(call.headers.accept).toBe('*/*')
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect([...bytes]).toEqual([...pdf])
    })

    it('accepts docx', async () => {
        const fetch = mockFetch([bytesResponse(new Uint8Array([1]))])
        await client(fetch).chat.export(MESSAGE_ID, { format: 'docx' })
        expect(fetch.calls[0]!.url).toMatch(/\?format=docx$/)
    })

    it('rejects another format and a bad id together, before any request', async () => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.export('nope', { format: 'html' as 'pdf' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(InvalidParams)
        expect((error as InvalidParams).errors).toEqual([
            { param: 'messageId', message: 'must be a message UUID', input: 'nope' },
            { param: 'format', message: "must be 'pdf' or 'docx'", input: 'html' },
        ])
        expect(noCall.calls).toHaveLength(0)
    })

    it('requires a format', async () => {
        await expect(
            client(mockFetch([])).chat.export(MESSAGE_ID, {} as { format: 'pdf' }),
        ).rejects.toThrow("format: required, must be 'pdf' or 'docx'")
    })

    it('surfaces "Message has no content" as an APIError with status 400', async () => {
        const fetch = mockFetch([
            jsonResponse({ detail: 'Message has no content' }, { status: 400 }),
        ])
        const error = await client(fetch)
            .chat.export(MESSAGE_ID, { format: 'pdf' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).message).toBe('Message has no content')
    })
})

const UPLOAD_URL = 'https://bucket.s3.amazonaws.com/'
const SIGNED_URL = 'https://bucket.s3.amazonaws.com/files/abc?X-Amz-Signature=secret'

function permission(fields: Record<string, string> = {}) {
    return jsonResponse({
        url: UPLOAD_URL,
        fields: { key: 'uploads/abc', policy: 'p0l1cy', 'x-amz-signature': 'sig', ...fields },
    })
}

function stored(etag: string | null = '"etag-1"') {
    return new Response(null, { status: 204, headers: etag === null ? {} : { etag } })
}

describe('chat.uploadFile', () => {
    it('asks for a permission, posts the form to storage, then confirms', async () => {
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        const file = await client(fetch).chat.uploadFile(new TextEncoder().encode('a,b\n1,2\n'), {
            filename: 'data.csv',
        })
        expect(file.id).toBe('file_1')

        const [ask, upload, confirm] = fetch.calls
        expect(ask!.method).toBe('GET')
        expect(ask!.url).toBe(
            'https://ds.cominty.com/chat/files/upload?filename=data.csv&mimetype=text%2Fcsv',
        )
        expect(ask!.headers['x-cominty-token']).toBe('ck_live_test')

        expect(upload!.method).toBe('POST')
        expect(upload!.url).toBe(UPLOAD_URL)
        expect(upload!.redirect).toBe('manual')
        const form = upload!.rawBody as FormData
        expect(form).toBeInstanceOf(FormData)
        // The presigned fields first, the file last: S3 ignores fields after it.
        expect([...form.keys()]).toEqual(['key', 'policy', 'x-amz-signature', 'file'])
        expect(form.get('key')).toBe('uploads/abc')
        const part = form.get('file') as File
        expect(part.name).toBe('data.csv')
        expect(part.type).toBe('text/csv')
        expect(await part.text()).toBe('a,b\n1,2\n')

        expect(confirm!.method).toBe('POST')
        expect(confirm!.url).toBe('https://ds.cominty.com/chat/files')
        expect(confirm!.body).toEqual({ etag: '"etag-1"', key: 'uploads/abc' })
    })

    it('never sends the API key, or any header of ours, to the storage host', async () => {
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        await client(fetch).chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
        expect(fetch.calls[1]!.headers).toEqual({})
    })

    it("takes a File's name and type", async () => {
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        const file = new File(['# Hi'], 'notes.txt', { type: 'text/x-custom' })
        await client(fetch).chat.uploadFile(file)

        expect(fetch.calls[0]!.url).toBe(
            'https://ds.cominty.com/chat/files/upload?filename=notes.txt&mimetype=text%2Fx-custom',
        )
        const part = (fetch.calls[1]!.rawBody as FormData).get('file') as File
        expect(part.name).toBe('notes.txt')
    })

    it('lets filename and mimetype override what the File says', async () => {
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
        await client(fetch).chat.uploadFile(file, {
            filename: 'renamed.md',
            mimetype: 'text/markdown',
        })

        expect(fetch.calls[0]!.url).toBe(
            'https://ds.cominty.com/chat/files/upload?filename=renamed.md&mimetype=text%2Fmarkdown',
        )
        const part = (fetch.calls[1]!.rawBody as FormData).get('file') as File
        expect(part.name).toBe('renamed.md')
        expect(part.type).toBe('text/markdown')
    })

    it.each([
        ['report.PDF', 'application/pdf'],
        [
            'slides.pptx',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        ['photo.jpeg', 'image/jpeg'],
        ['data.unknownext', 'application/octet-stream'],
        ['README', 'application/octet-stream'],
    ])('guesses the mimetype of %s from its name', async (filename, mimetype) => {
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        await client(fetch).chat.uploadFile(new ArrayBuffer(1), { filename })
        expect(new URL(fetch.calls[0]!.url).searchParams.get('mimetype')).toBe(mimetype)
    })

    it('accepts a Blob, an ArrayBuffer, a Uint8Array and a Node Buffer', async () => {
        const sources = [
            new Blob(['abc']),
            new TextEncoder().encode('abc').buffer,
            new TextEncoder().encode('abc'),
            Buffer.from('abc'),
        ]
        for (const source of sources) {
            const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
            await client(fetch).chat.uploadFile(source, { filename: 'a.txt' })
            const part = (fetch.calls[1]!.rawBody as FormData).get('file') as File
            expect(await part.text()).toBe('abc')
        }
    })

    it('refuses a string, naming the way to upload a path', async () => {
        const noCall = mockFetch([])
        await expect(
            client(noCall).chat.uploadFile('q3.pdf' as unknown as Blob, { filename: 'q3.pdf' }),
        ).rejects.toThrow(
            'file: must be a Blob, File, ArrayBuffer or Uint8Array, got string: a string is ' +
                'ambiguous between a path and text. In Node, upload a path with await fs.openAsBlob(path)',
        )
        expect(noCall.calls).toHaveLength(0)
    })

    it('names every problem at once, and never echoes the file', async () => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.uploadFile({ secret: 'sk-cmt-123' } as unknown as Blob, { mimetype: '' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(InvalidParams)
        expect((error as InvalidParams).errors).toEqual([
            {
                param: 'file',
                message: 'must be a Blob, File, ArrayBuffer or Uint8Array, got Object',
            },
            { param: 'filename', message: 'required unless file is a File with a name' },
            { param: 'mimetype', message: 'must be a non-empty string', input: '' },
        ])
        expect((error as Error).message).not.toContain('sk-cmt-123')
    })

    it.each([
        ['empty', '', 'must not be empty'],
        ['with a slash', 'a/b.txt', "must not contain '/'"],
        [
            'over 255 characters',
            `${'n'.repeat(252)}.txt`,
            'must be at most 255 characters, got 256',
        ],
    ])('refuses a filename %s', async (_label, filename, message) => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.uploadFile(new Uint8Array([1]), { filename })
            .catch((e: unknown) => e)
        expect((error as InvalidParams).errors[0]).toMatchObject({ param: 'filename', message })
        expect(noCall.calls).toHaveLength(0)
    })

    it('accepts a filename of 255 characters', async () => {
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        await client(fetch).chat.uploadFile(new Uint8Array([1]), { filename: 'n'.repeat(255) })
        expect(fetch.calls).toHaveLength(3)
    })

    it('refuses a file over 500 MiB before anything is sent', async () => {
        const noCall = mockFetch([])
        const big = { size: UPLOAD_MAX_BYTES + 1, type: '' }
        Object.setPrototypeOf(big, Blob.prototype)
        await expect(
            client(noCall).chat.uploadFile(big as Blob, { filename: 'big.bin' }),
        ).rejects.toThrow(
            `file: is ${UPLOAD_MAX_BYTES + 1} bytes, over the ${UPLOAD_MAX_BYTES} bytes`,
        )
        expect(noCall.calls).toHaveLength(0)
    })

    it.each([
        ['no url', { fields: { key: 'k' } }],
        ['no fields', { url: UPLOAD_URL }],
        ['no key', { url: UPLOAD_URL, fields: { policy: 'secret-policy' } }],
        ['null', null],
    ])('throws SDKError when the permission has %s, without echoing it', async (_label, body) => {
        const fetch = mockFetch([jsonResponse(body)])
        const error = await client(fetch)
            .chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(SDKError)
        expect((error as Error).message).not.toContain('secret-policy')
        expect(fetch.calls).toHaveLength(1)
    })

    it('throws SDKError when storage accepts the file but sends no ETag', async () => {
        const fetch = mockFetch([permission(), stored(null)])
        await expect(
            client(fetch).chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' }),
        ).rejects.toThrow(
            new SDKError('the storage backend accepted the upload but sent no ETag header'),
        )
        expect(fetch.calls).toHaveLength(2)
    })

    it("surfaces the storage backend's XML error as the detail", async () => {
        const xml =
            '<?xml version="1.0"?><Error><Code>EntityTooLarge</Code>' +
            '<Message>Your proposed upload exceeds the maximum &amp; allowed size</Message></Error>'
        const fetch = mockFetch([
            permission(),
            new Response(xml, { status: 400, headers: { 'content-type': 'application/xml' } }),
        ])
        const error = await client(fetch)
            .chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).status).toBe(400)
        expect((error as APIError).detail).toBe(
            'EntityTooLarge: Your proposed upload exceeds the maximum & allowed size',
        )
    })

    it('maps a storage 403 to PermissionError', async () => {
        const xml = '<Error><Code>AccessDenied</Code></Error>'
        const fetch = mockFetch([
            permission(),
            new Response(xml, { status: 403, headers: { 'content-type': 'application/xml' } }),
        ])
        const error = await client(fetch)
            .chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(PermissionError)
        expect((error as APIError).detail).toBe('AccessDenied')
    })

    it('treats a storage redirect as a failure', async () => {
        const fetch = mockFetch([
            permission(),
            new Response(null, { status: 307, headers: { location: 'https://elsewhere/' } }),
        ])
        const error = await client(fetch)
            .chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(APIError)
        expect((error as APIError).detail).toBe(
            'the storage backend answered with a redirect instead of the file',
        )
    })

    it('keeps the presigned signature out of a connection error', async () => {
        const fetch = mockFetch([
            jsonResponse({ url: SIGNED_URL, fields: { key: 'k' } }),
            () => {
                throw new TypeError('socket hang up')
            },
        ])
        const error = await client(fetch)
            .chat.uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(APIConnectionError)
        expect((error as Error).message).toBe(
            'Upload to https://bucket.s3.amazonaws.com/files/abc failed: socket hang up',
        )
    })

    it('passes the signal to every request', async () => {
        const controller = new AbortController()
        const fetch = mockFetch([permission(), stored(), jsonResponse(conversationFile())])
        await client(fetch).chat.uploadFile(new Uint8Array([1]), {
            filename: 'a.bin',
            signal: controller.signal,
        })
        expect(fetch.calls.map((c) => c.signal?.aborted)).toEqual([false, false, false])
        controller.abort()
        expect(fetch.calls.map((c) => c.signal?.aborted)).toEqual([true, true, true])
    })

    it('times out a stalled storage upload with the client timeout', async () => {
        const fetch = mockFetch([permission(), stalledResponse])
        const error = await new Cominty({ apiToken: 'k', userId: USER_ID, fetch, timeout: 5 }).chat
            .uploadFile(new Uint8Array([1]), { filename: 'a.bin' })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(APIConnectionError)
        expect((error as Error).message).toBe(
            'Upload to https://bucket.s3.amazonaws.com/ timed out',
        )
    })
})

describe('chat.downloadFile', () => {
    it('gets the presigned URL, then the bytes from it without the API key', async () => {
        const fetch = mockFetch([
            jsonResponse(SIGNED_URL),
            bytesResponse(new Uint8Array([104, 105])),
        ])
        const bytes = await client(fetch).chat.downloadFile('file_1')

        const [ask, download] = fetch.calls
        expect(ask!.method).toBe('GET')
        expect(ask!.url).toBe('https://ds.cominty.com/chat/files/file_1')
        expect(ask!.headers['x-cominty-token']).toBe('ck_live_test')
        expect(download!.url).toBe(SIGNED_URL)
        expect(download!.headers).toEqual({})
        expect(download!.redirect).toBe('manual')
        expect(new TextDecoder().decode(bytes)).toBe('hi')
    })

    it('encodes the file id into the path', async () => {
        const fetch = mockFetch([jsonResponse(SIGNED_URL), bytesResponse(new Uint8Array())])
        await client(fetch).chat.downloadFile('a/b c')
        expect(fetch.calls[0]!.url).toBe('https://ds.cominty.com/chat/files/a%2Fb%20c')
    })

    it('rejects an empty file id, before any request', async () => {
        const noCall = mockFetch([])
        await expect(client(noCall).chat.downloadFile('')).rejects.toThrow(
            'Invalid parameters for chat.downloadFile:\n  - fileId: required, must be a non-empty string',
        )
        expect(noCall.calls).toHaveLength(0)
    })

    it('throws SDKError when the API does not answer with a URL', async () => {
        const fetch = mockFetch([jsonResponse({ url: SIGNED_URL })])
        await expect(client(fetch).chat.downloadFile('file_1')).rejects.toThrow(
            new SDKError('GET /chat/files/file_1 did not answer with a download URL string'),
        )
    })

    it('surfaces an unknown file as NotFoundError', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'Not found' }, { status: 404 })])
        await expect(client(fetch).chat.downloadFile('file_1')).rejects.toThrow(NotFoundError)
    })

    it('surfaces an expired link as the storage error, without the signature', async () => {
        const xml = '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>'
        const fetch = mockFetch([
            jsonResponse(SIGNED_URL),
            new Response(xml, { status: 403, headers: { 'content-type': 'application/xml' } }),
        ])
        const error = await client(fetch)
            .chat.downloadFile('file_1')
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(PermissionError)
        expect((error as APIError).message).toBe('AccessDenied: Request has expired')
        expect((error as Error).message).not.toContain('secret')
    })
})
