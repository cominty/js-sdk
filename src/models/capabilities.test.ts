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
import { ALL, type AgentCapabilities, type MessageScope } from './capabilities.ts'
import type { StartChatParams } from './chat.ts'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

/** Start a thread and return the body sent. */
async function startBody(params: Partial<StartChatParams>) {
    const fetch = mockFetch([jsonResponse(startedThread())])
    await client(fetch).chat.start({ agentId: AGENT_ID, message: 'Hi', ...params })
    return fetch.calls[0]!.body as {
        message: Record<string, unknown>
        options: Record<string, unknown>
    }
}

/** Start a thread that must be refused, and return the offending params. */
async function refusedParams(params: Partial<StartChatParams>): Promise<InvalidParams> {
    const noCall = mockFetch([])
    const error = await client(noCall)
        .chat.start({ agentId: AGENT_ID, message: 'Hi', ...params })
        .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InvalidParams)
    expect(noCall.calls).toHaveLength(0)
    return error as InvalidParams
}

function params(error: InvalidParams): string[] {
    return error.errors.map((e) => e.param)
}

function loose(value: unknown): AgentCapabilities {
    return value as AgentCapabilities
}

function looseScope(value: unknown): MessageScope {
    return value as MessageScope
}

describe('ALL', () => {
    it("is the string '*'", () => {
        expect(ALL).toBe('*')
    })
})

describe('threadCapabilities', () => {
    it('is sent as options.capabilities, in snake_case, with filters defaulting to ALL', async () => {
        const body = await startBody({
            threadCapabilities: {
                web: { activation: 'always' },
                indexedDocuments: { activation: 'always', sourceIds: [101] },
                mcp: { activation: 'on_request', connections: ALL },
                skills: { activation: 'always' },
                imageGeneration: { activation: 'on_request' },
                videoGeneration: { activation: 'never' },
                musicGeneration: { activation: 'always' },
                memory: { activation: 'always', namespace: 'support-bot' },
            },
        })
        expect(body.options).toEqual({
            agent_id: AGENT_ID,
            user_id: USER_ID,
            capabilities: {
                web: { activation: 'always' },
                indexed_documents: { activation: 'always', source_ids: [101], document_ids: '*' },
                mcp: { activation: 'on_request', connections: '*' },
                skills: { activation: 'always', include: '*' },
                image_generation: { activation: 'on_request' },
                video_generation: { activation: 'never' },
                music_generation: { activation: 'always' },
                memory: { activation: 'always', namespace: 'support-bot' },
            },
        })
    })

    it('leaves out the capabilities not passed, and sends {} for an empty object', async () => {
        const one = await startBody({ threadCapabilities: { web: { activation: 'never' } } })
        expect(one.options.capabilities).toEqual({ web: { activation: 'never' } })

        const none = await startBody({ threadCapabilities: {} })
        expect(none.options.capabilities).toEqual({})
    })

    it('is left out of the request when absent', async () => {
        const body = await startBody({})
        expect('capabilities' in body.options).toBe(false)
    })

    it("sends only { activation: 'never' } for a capability that is off", async () => {
        const body = await startBody({
            threadCapabilities: {
                indexedDocuments: { activation: 'never' },
                mcp: { activation: 'never' },
                skills: { activation: 'never' },
                memory: { activation: 'never' },
            },
        })
        expect(body.options.capabilities).toEqual({
            indexed_documents: { activation: 'never' },
            mcp: { activation: 'never' },
            skills: { activation: 'never' },
            memory: { activation: 'never' },
        })
    })

    it('accepts a filter left explicitly undefined as ALL', async () => {
        const body = await startBody({
            threadCapabilities: { mcp: { activation: 'always', connections: undefined } },
        })
        expect(body.options.capabilities).toEqual({
            mcp: { activation: 'always', connections: '*' },
        })
    })

    it('can be sent together with a message scope', async () => {
        const body = await startBody({
            threadCapabilities: { imageGeneration: { activation: 'on_request' } },
            messageScope: { imageGeneration: { enabled: true } },
        })
        expect(body.options.capabilities).toEqual({
            image_generation: { activation: 'on_request' },
        })
        expect(body.message.scope).toEqual({ image_generation: { enabled: true } })
    })

    describe('activation', () => {
        it('is required', async () => {
            const error = await refusedParams({ threadCapabilities: loose({ web: {} }) })
            expect(error.message).toContain(
                "threadCapabilities.web.activation: required, must be one of 'always', 'on_request', 'never'",
            )
        })

        it('must be always, on_request or never', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({ web: { activation: 'sometimes' } }),
            })
            expect(params(error)).toEqual(['threadCapabilities.web.activation'])
        })

        it.each(['skills', 'memory'])('has no on_request for %s', async (name) => {
            const error = await refusedParams({
                threadCapabilities: loose({ [name]: { activation: 'on_request' } }),
            })
            expect(error.errors[0]).toMatchObject({
                param: `threadCapabilities.${name}.activation`,
                message: `must be one of 'always', 'never': ${name} has no 'on_request'`,
            })
        })
    })

    describe('shortcuts are refused', () => {
        it.each([
            ['true', true],
            ['a string', 'always'],
            ['null', null],
            ['an array', []],
        ])('a capability given as %s', async (_label, value) => {
            const error = await refusedParams({ threadCapabilities: loose({ web: value }) })
            expect(params(error)).toEqual(['threadCapabilities.web'])
        })

        it.each([
            ['null', null],
            ['a string', 'web'],
            ['an array', []],
        ])('threadCapabilities given as %s', async (_label, value) => {
            const error = await refusedParams({ threadCapabilities: loose(value) })
            expect(params(error)).toEqual(['threadCapabilities'])
        })
    })

    describe('unknown keys', () => {
        it('are refused at the top level', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({ browser: { activation: 'always' } }),
            })
            expect(params(error)).toEqual(['threadCapabilities.browser'])
            expect(error.errors[0]!.message).toMatch(/^unknown key, expected one of web, /)
        })

        it('are refused inside a capability', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({ web: { activation: 'always', domains: ['a.com'] } }),
            })
            expect(error.errors[0]).toMatchObject({
                param: 'threadCapabilities.web.domains',
                message: 'unknown key, expected one of activation',
            })
        })

        it('point a snake_case key to its camelCase name', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({
                    indexed_documents: { activation: 'always' },
                    indexedDocuments: { activation: 'always', source_ids: [1] },
                }),
            })
            expect(error.errors).toEqual([
                {
                    param: 'threadCapabilities.indexed_documents',
                    message: "unknown key: arguments are camelCase, use 'indexedDocuments'",
                },
                {
                    param: 'threadCapabilities.indexedDocuments.source_ids',
                    message: "unknown key: arguments are camelCase, use 'sourceIds'",
                },
            ])
        })
    })

    describe('filters', () => {
        it.each([
            ['indexedDocuments', 'sourceIds'],
            ['indexedDocuments', 'documentIds'],
            ['mcp', 'connections'],
            ['skills', 'include'],
        ])('%s.%s refuses null', async (name, key) => {
            const error = await refusedParams({
                threadCapabilities: loose({ [name]: { activation: 'always', [key]: null } }),
            })
            expect(error.errors).toEqual([
                {
                    param: `threadCapabilities.${name}.${key}`,
                    message:
                        "null is not accepted: pass ALL ('*') for no restriction, or a non-empty array",
                },
            ])
        })

        it.each([
            ['indexedDocuments', 'sourceIds'],
            ['indexedDocuments', 'documentIds'],
            ['mcp', 'connections'],
            ['skills', 'include'],
        ])('%s.%s refuses an empty array', async (name, key) => {
            const error = await refusedParams({
                threadCapabilities: loose({ [name]: { activation: 'always', [key]: [] } }),
            })
            expect(error.errors[0]!.message).toMatch(/^an empty array is ambiguous/)
        })

        it.each([
            ['indexedDocuments', 'documentIds'],
            ['mcp', 'connections'],
            ['skills', 'include'],
        ])("%s.%s refuses '*' inside an array", async (name, key) => {
            const error = await refusedParams({
                threadCapabilities: loose({ [name]: { activation: 'always', [key]: ['a', '*'] } }),
            })
            expect(error.errors).toEqual([
                {
                    param: `threadCapabilities.${name}.${key}[1]`,
                    message:
                        "'*' inside an array is not accepted: pass ALL on its own for every id",
                },
            ])
        })

        it('refuses a string other than ALL', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({ mcp: { activation: 'always', connections: 'linear' } }),
            })
            expect(error.errors[0]).toMatchObject({
                param: 'threadCapabilities.mcp.connections',
                message: "must be ALL ('*') or a non-empty array of strings",
            })
        })

        it('requires integer source ids', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({
                    indexedDocuments: { activation: 'always', sourceIds: [1, '2', 2.5] },
                }),
            })
            expect(params(error)).toEqual([
                'threadCapabilities.indexedDocuments.sourceIds[1]',
                'threadCapabilities.indexedDocuments.sourceIds[2]',
            ])
            expect(error.errors[0]!.message).toBe('must be an integer')
        })

        it('requires string ids in the other filters', async () => {
            const error = await refusedParams({
                threadCapabilities: loose({ mcp: { activation: 'always', connections: [7] } }),
            })
            expect(error.errors[0]).toMatchObject({
                param: 'threadCapabilities.mcp.connections[0]',
                message: 'must be a string',
            })
        })

        it.each([
            ['indexedDocuments', 'sourceIds', [1]],
            ['indexedDocuments', 'documentIds', ALL],
            ['mcp', 'connections', ['linear']],
            ['skills', 'include', ALL],
        ])("%s.%s is refused with activation 'never'", async (name, key, value) => {
            const error = await refusedParams({
                threadCapabilities: loose({ [name]: { activation: 'never', [key]: value } }),
            })
            expect(error.errors).toEqual([
                {
                    param: `threadCapabilities.${name}.${key}`,
                    message: 'not accepted when the capability is off: it takes no filter',
                    input: value,
                },
            ])
        })
    })

    describe('memory', () => {
        it("requires a namespace with activation 'always'", async () => {
            for (const namespace of [undefined, null]) {
                const error = await refusedParams({
                    threadCapabilities: loose({ memory: { activation: 'always', namespace } }),
                })
                expect(error.errors).toEqual([
                    {
                        param: 'threadCapabilities.memory.namespace',
                        message:
                            "required when activation is 'always': the memory bag the thread reads and writes",
                    },
                ])
            }
        })

        it("refuses a namespace with activation 'never'", async () => {
            const error = await refusedParams({
                threadCapabilities: loose({ memory: { activation: 'never', namespace: 'bag' } }),
            })
            expect(error.errors[0]).toMatchObject({
                param: 'threadCapabilities.memory.namespace',
                message: "not accepted with activation 'never': memory is off",
            })
        })

        it('checks the namespace like memoryNamespace: a string of at most 128 characters', async () => {
            const long = await refusedParams({
                threadCapabilities: {
                    memory: { activation: 'always', namespace: 'n'.repeat(129) },
                },
            })
            expect(long.message).toContain(
                'threadCapabilities.memory.namespace: must be at most 128 characters, got 129',
            )

            const number = await refusedParams({
                threadCapabilities: loose({ memory: { activation: 'always', namespace: 7 } }),
            })
            expect(number.errors[0]!.message).toBe('must be a string')

            const body = await startBody({
                threadCapabilities: {
                    memory: { activation: 'always', namespace: '😀'.repeat(128) },
                },
            })
            expect(body.options.capabilities).toEqual({
                memory: { activation: 'always', namespace: '😀'.repeat(128) },
            })
        })

        it('refuses an empty namespace, which the API would answer with a 422', async () => {
            const error = await refusedParams({
                threadCapabilities: { memory: { activation: 'always', namespace: '' } },
            })
            expect(error.errors[0]).toMatchObject({
                param: 'threadCapabilities.memory.namespace',
                message: 'must not be empty',
            })
        })

        it('cannot be combined with the deprecated memoryNamespace', async () => {
            const error = await refusedParams({
                memoryNamespace: 'bag',
                threadCapabilities: { memory: { activation: 'never' } },
            })
            expect(params(error)).toEqual(['memoryNamespace'])
            expect(error.errors[0]!.message).toMatch(
                /cannot be combined with threadCapabilities\.memory/,
            )
        })

        it('leaves memoryNamespace working beside other capabilities', async () => {
            const body = await startBody({
                memoryNamespace: 'bag',
                threadCapabilities: { web: { activation: 'always' } },
            })
            expect(body.options).toMatchObject({
                memory_namespace: 'bag',
                capabilities: { web: { activation: 'always' } },
            })
        })
    })

    it('names every problem at once', async () => {
        const error = await refusedParams({
            maxSteps: 0,
            threadCapabilities: loose({
                web: {},
                skills: { activation: 'on_request', include: [] },
                memory: { activation: 'always' },
            }),
            messageScope: looseScope({ web: { enabled: 'yes' } }),
        })
        expect(params(error)).toEqual([
            'maxSteps',
            'threadCapabilities.web.activation',
            'threadCapabilities.skills.activation',
            'threadCapabilities.skills.include',
            'threadCapabilities.memory.namespace',
            'messageScope.web.enabled',
        ])
    })

    it('is refused by send: a thread keeps the capabilities it was started with', async () => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.send(THREAD_ID, {
                agentId: AGENT_ID,
                message: 'Follow up',
                // @ts-expect-error -- the send params do not have it: the type refuses it too.
                threadCapabilities: { web: { activation: 'never' } },
            })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(InvalidParams)
        expect((error as InvalidParams).errors).toEqual([
            {
                param: 'threadCapabilities',
                message:
                    'not accepted on a follow-up: a thread keeps the capabilities it was started ' +
                    'with. Narrow them for this message with messageScope instead',
            },
        ])
        expect(noCall.calls).toHaveLength(0)
    })
})

describe('messageScope', () => {
    it('is sent as message.scope by start and send, with filters defaulting to ALL', async () => {
        const fetch = mockFetch([jsonResponse(startedThread()), jsonResponse(assistantMessage())])
        const c = client(fetch)
        const scope: MessageScope = {
            indexedDocuments: { enabled: true, sourceIds: [101] },
            mcp: { enabled: true, connections: ['linear'] },
            web: { enabled: false },
            imageGeneration: { enabled: true },
            videoGeneration: { enabled: false },
            musicGeneration: { enabled: true },
        }
        await c.chat.start({ agentId: AGENT_ID, message: 'Hi', messageScope: scope })
        await c.chat.send(THREAD_ID, {
            agentId: AGENT_ID,
            message: 'Only 2024',
            messageScope: scope,
        })

        for (const call of fetch.calls) {
            expect((call.body as { message: object }).message).toEqual({
                content: expect.any(String),
                scope: {
                    indexed_documents: { enabled: true, source_ids: [101], document_ids: '*' },
                    mcp: { enabled: true, connections: ['linear'] },
                    web: { enabled: false },
                    image_generation: { enabled: true },
                    video_generation: { enabled: false },
                    music_generation: { enabled: true },
                },
            })
        }
    })

    it('sends only { enabled: false } for a capability turned off', async () => {
        const body = await startBody({
            messageScope: { indexedDocuments: { enabled: false }, mcp: { enabled: false } },
        })
        expect(body.message.scope).toEqual({
            indexed_documents: { enabled: false },
            mcp: { enabled: false },
        })
    })

    it('is left out of the request when absent', async () => {
        const body = await startBody({})
        expect('scope' in body.message).toBe(false)
    })

    it.each([
        ['missing', undefined, 'required, must be true or false'],
        ['a string', 'true', 'must be true or false'],
        ['null', null, 'must be true or false'],
    ])('refuses enabled %s', async (_label, enabled, message) => {
        const error = await refusedParams({ messageScope: looseScope({ web: { enabled } }) })
        expect(error.errors[0]).toMatchObject({ param: 'messageScope.web.enabled', message })
    })

    it('refuses a filter with enabled: false', async () => {
        const error = await refusedParams({
            messageScope: looseScope({ mcp: { enabled: false, connections: ['linear'] } }),
        })
        expect(error.errors[0]).toMatchObject({
            param: 'messageScope.mcp.connections',
            message: 'not accepted when the capability is off: it takes no filter',
        })
    })

    it('checks its filters like the thread capabilities do', async () => {
        const error = await refusedParams({
            messageScope: looseScope({
                indexedDocuments: { enabled: true, sourceIds: null, documentIds: ['*'] },
                mcp: { enabled: true, connections: [] },
            }),
        })
        expect(params(error)).toEqual([
            'messageScope.indexedDocuments.sourceIds',
            'messageScope.indexedDocuments.documentIds[0]',
            'messageScope.mcp.connections',
        ])
    })

    it.each(['skills', 'memory'])('has no %s scope', async (name) => {
        const error = await refusedParams({
            messageScope: looseScope({ [name]: { enabled: true } }),
        })
        expect(params(error)).toEqual([`messageScope.${name}`])
        expect(error.errors[0]!.message).toMatch(
            new RegExp(`^a message has no ${name} scope: .* threadCapabilities\\.${name}$`),
        )
    })

    it('refuses unknown keys, and shortcuts', async () => {
        const error = await refusedParams({
            messageScope: looseScope({
                web: true,
                browser: { enabled: true },
                mcp: { enabled: true, all: 1 },
            }),
        })
        expect(params(error)).toEqual([
            'messageScope.browser',
            'messageScope.web',
            'messageScope.mcp.all',
        ])
    })

    it.each(['sourceIds', 'documentIds', 'disabledTools'] as const)(
        'cannot be combined with the deprecated %s',
        async (legacy) => {
            const value =
                legacy === 'sourceIds' ? [1] : legacy === 'disabledTools' ? ['web'] : ['d']
            const error = await refusedParams({
                messageScope: { web: { enabled: true } },
                [legacy]: value,
            })
            expect(params(error)).toEqual([legacy])
            expect(error.errors[0]!.message).toMatch(
                /^cannot be combined with messageScope: send only messageScope, with /,
            )
        },
    )

    it('is refused with the legacy fields on send too, all named at once', async () => {
        const noCall = mockFetch([])
        const error = await client(noCall)
            .chat.send(THREAD_ID, {
                agentId: AGENT_ID,
                message: 'Hi',
                messageScope: { web: { enabled: false } },
                sourceIds: [1],
                documentIds: ['d'],
                disabledTools: ['web'],
            })
            .catch((e: unknown) => e)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual([
            'sourceIds',
            'documentIds',
            'disabledTools',
        ])
        expect(noCall.calls).toHaveLength(0)
    })

    it('leaves the deprecated fields working on their own', async () => {
        const body = await startBody({ sourceIds: [1], documentIds: ['d'], disabledTools: ['web'] })
        expect(body.message).toEqual({
            content: 'Hi',
            source_ids: [1],
            document_ids: ['d'],
            disabled_tools: ['web'],
        })
    })
})
