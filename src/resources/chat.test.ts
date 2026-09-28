import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { InvalidParams } from '../errors.ts'
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
