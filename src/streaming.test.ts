import { describe, expect, it } from 'vitest'
import { Cominty } from './client.ts'
import { APIConnectionError, SDKError, StreamInterrupted } from './errors.ts'
import type { AnyEvent } from './events.ts'
import {
    AGENT_ID,
    assistantMessage,
    eventLine,
    MESSAGE_ID,
    mockFetch,
    streamResponse,
    USER_ID,
} from './test-utils.ts'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

describe('AssistantRun', () => {
    it('yields progress events and captures the terminal message', async () => {
        const fetch = mockFetch([
            streamResponse([
                eventLine('waiting_for_start'),
                eventLine('llm', {
                    id: '1718000000001-0',
                    data: { description: 'Generating reply', model: 'claude-sonnet-5' },
                }),
                eventLine('result', {
                    id: '1718000000002-0',
                    status: 'success',
                    data: { reply: 'Hello from the agent.', files: [], cost: { total: '0.01' } },
                }),
                `${JSON.stringify(assistantMessage())}\n`,
            ]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)

        const names: string[] = []
        for await (const event of run) names.push(event.name)

        expect(names).toEqual(['waiting_for_start', 'llm', 'result'])
        expect(await run.text()).toBe('Hello from the agent.')
    })

    it('skips the bare "heartbeat" line the server sends during idle steps', async () => {
        const fetch = mockFetch([
            streamResponse([
                eventLine('waiting_for_start'),
                '"heartbeat"\n',
                '\n',
                'not json at all\n',
                `${JSON.stringify(assistantMessage())}\n`,
            ]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)

        const events: AnyEvent[] = []
        for await (const event of run) events.push(event)

        expect(events).toHaveLength(1)
        expect(await run.text()).toBe('Hello from the agent.')
    })

    it('reads a terminal message that arrives with no trailing newline', async () => {
        const fetch = mockFetch([
            // No '\n' after the final object — exactly what the wire does.
            streamResponse([eventLine('llm'), JSON.stringify(assistantMessage())]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)
        expect(await run.text()).toBe('Hello from the agent.')
    })

    it('reassembles a JSON object split across two chunks', async () => {
        const terminal = JSON.stringify(assistantMessage())
        const fetch = mockFetch([streamResponse([terminal.slice(0, 30), terminal.slice(30)])])
        const run = client(fetch).chat.stream(MESSAGE_ID)
        expect(await run.text()).toBe('Hello from the agent.')
    })

    it('does not end the stream on the result event', async () => {
        const fetch = mockFetch([
            streamResponse([
                eventLine('result', {
                    status: 'success',
                    data: { reply: 'early', files: [], cost: { total: '0' } },
                }),
                // A late sandbox event legitimately follows the result.
                eventLine('setting_up_sandbox', { id: '1718000000009-0', status: 'success' }),
                `${JSON.stringify(assistantMessage())}\n`,
            ]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)

        const names: string[] = []
        for await (const event of run) names.push(event.name)

        expect(names).toEqual(['result', 'setting_up_sandbox'])
    })

    it('throws StreamInterrupted carrying the partial message on server shutdown', async () => {
        const partial = assistantMessage({ content: 'half an ans', status: 'running' })
        const fetch = mockFetch([
            streamResponse([
                eventLine('llm'),
                `${JSON.stringify({ __server_is_shutting_down: true, partial })}\n`,
            ]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)

        await expect(async () => {
            for await (const _ of run) {
                // drain
            }
        }).rejects.toThrow(StreamInterrupted)
    })

    it('raises APIConnectionError when the connection drops mid-stream', async () => {
        const encoder = new TextEncoder()
        const cause = new TypeError('terminated')
        let pulls = 0
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pulls++ === 0) {
                    controller.enqueue(encoder.encode(eventLine('llm', { id: '1718000000001-0' })))
                } else {
                    controller.error(cause)
                }
            },
        })
        const run = client(mockFetch([new Response(body)])).chat.stream(MESSAGE_ID)

        const names: string[] = []
        const error = await (async () => {
            for await (const event of run) names.push(event.name)
        })().catch((e: unknown) => e)

        expect(names).toEqual(['llm'])
        expect(error).toBeInstanceOf(APIConnectionError)
        expect((error as APIConnectionError).cause).toBe(cause)
        // Where to resume from.
        expect(run.lastEventId).toBe('1718000000001-0')
    })

    it('sends last-event-id when resuming, and tracks it while streaming', async () => {
        const fetch = mockFetch([
            streamResponse([
                eventLine('llm', { id: '1718000000007-0' }),
                `${JSON.stringify(assistantMessage())}\n`,
            ]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID, { lastEventId: '1718000000003-0' })

        for await (const _ of run) {
            // drain
        }

        expect(fetch.calls[0]!.headers['last-event-id']).toBe('1718000000003-0')
        expect(run.lastEventId).toBe('1718000000007-0')
    })

    it('omits last-event-id when starting from the top', async () => {
        const fetch = mockFetch([streamResponse([`${JSON.stringify(assistantMessage())}\n`])])
        const run = client(fetch).chat.stream(MESSAGE_ID)
        await run.result()
        expect('last-event-id' in fetch.calls[0]!.headers).toBe(false)
    })

    it('is single-use: a second iteration throws rather than re-requesting', async () => {
        const fetch = mockFetch([streamResponse([`${JSON.stringify(assistantMessage())}\n`])])
        const run = client(fetch).chat.stream(MESSAGE_ID)
        await run.result()

        await expect(async () => {
            for await (const _ of run) {
                // drain
            }
        }).rejects.toThrow(SDKError)
        expect(fetch.calls).toHaveLength(1)
    })

    it('caches the result, so text() after iterating costs nothing', async () => {
        const fetch = mockFetch([
            streamResponse([eventLine('llm'), `${JSON.stringify(assistantMessage())}\n`]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)

        for await (const _ of run) {
            // drain
        }

        expect(await run.text()).toBe('Hello from the agent.')
        expect(await run.text()).toBe('Hello from the agent.')
        expect(fetch.calls).toHaveLength(1)
    })

    it('exposes the agent questions from the terminal message', async () => {
        const questions = [{ prompt: 'Which date?', options: ['Today', 'Tomorrow'] }]
        const fetch = mockFetch([
            streamResponse([`${JSON.stringify(assistantMessage({ questions }))}\n`]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)
        expect(await run.questions()).toEqual(questions)
    })

    it('returns an empty question list when the agent gave a final answer', async () => {
        const fetch = mockFetch([streamResponse([`${JSON.stringify(assistantMessage())}\n`])])
        const run = client(fetch).chat.stream(MESSAGE_ID)
        expect(await run.questions()).toEqual([])
    })

    it('refuses to hand back a result after a partial consume', async () => {
        const fetch = mockFetch([
            streamResponse([
                eventLine('llm'),
                eventLine('tool_call', {
                    id: '1718000000004-0',
                    data: { name: 'web', description: 'search' },
                }),
                `${JSON.stringify(assistantMessage())}\n`,
            ]),
        ])
        const run = client(fetch).chat.stream(MESSAGE_ID)

        for await (const _ of run) break // abandon after the first event

        await expect(run.result()).rejects.toThrow(SDKError)
    })

    it('streams a run started by chat.start, which carries its thread', async () => {
        const { startedThread } = await import('./test-utils.ts')
        const fetch = mockFetch([
            new Response(JSON.stringify(startedThread()), {
                headers: { 'content-type': 'application/json' },
            }),
            streamResponse([`${JSON.stringify(assistantMessage())}\n`]),
        ])
        const run = await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hi' })

        expect(run.thread.id).toBeDefined()
        expect(await run.text()).toBe('Hello from the agent.')
    })
})
