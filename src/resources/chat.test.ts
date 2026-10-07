import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { InvalidParams } from '../errors.ts'
import type { StartChatParams } from '../models/chat.ts'
import {
    AGENT_ID,
    assistantMessage,
    jsonResponse,
    mockFetch,
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
