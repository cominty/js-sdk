import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { InvalidParams, NotFoundError } from '../errors.ts'
import { agentWire, AGENT_OWNER, jsonResponse, mockFetch, USER_ID } from '../test-utils.ts'

const API = 'https://ds.cominty.com'
const AGENT = 'agt_V1StGXR8_Z5jdHi6B'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

describe('agents.list / listModels / get', () => {
    it('lists summaries', async () => {
        const fetch = mockFetch([jsonResponse([agentWire(), agentWire({ id: 'agt_2' })])])
        const agents = await client(fetch).agents.list()
        expect(agents.map((a) => a.id)).toEqual([AGENT, 'agt_2'])
        expect(agents[0]!.owner).toBe(AGENT_OWNER)
        expect(fetch.calls[0]!.url).toBe(`${API}/agents`)
    })

    it('reads capabilities back as camelCase and drops the unknown ones', async () => {
        const capabilities = {
            web: { activation: 'always' },
            indexed_documents: { activation: 'on_request', source_ids: [42], document_ids: '*' },
            memory: { activation: 'always', namespace: 'support' },
            skills: { activation: 'never', include: null },
            mcp: { activation: 'always', connections: '*', reranker: true },
            teleportation: { activation: 'always' },
        }
        const fetch = mockFetch([jsonResponse([agentWire({ capabilities })])])
        const [agent] = await client(fetch).agents.list()

        expect(agent!.capabilities).toEqual({
            web: { activation: 'always' },
            indexedDocuments: { activation: 'on_request', sourceIds: [42], documentIds: '*' },
            memory: { activation: 'always', namespace: 'support' },
            skills: { activation: 'never' },
        })
    })

    it('keeps null capabilities as null', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        expect((await client(fetch).agents.get(AGENT)).capabilities).toBeNull()
    })

    it('lists models and gets one agent', async () => {
        const fetch = mockFetch([
            jsonResponse([{ id: 'mdl_1', name: 'claude-sonnet' }]),
            jsonResponse(agentWire()),
        ])
        const models = await client(fetch).agents.listModels()
        const agent = await client(fetch).agents.get('agt/1')
        expect(models[0]!.id).toBe('mdl_1')
        expect(agent.instructions).toBe('Be brief.')
        expect(fetch.calls.map((c) => c.url)).toEqual([
            `${API}/agents/models`,
            `${API}/agents/agt%2F1`,
        ])
    })

    it('refuses an empty agent id before any request', async () => {
        const fetch = mockFetch([])
        await expect(client(fetch).agents.get('')).rejects.toThrow(/agentId: required/)
        await expect(client(fetch).agents.delete(undefined as never)).rejects.toThrow(InvalidParams)
        expect(fetch.calls).toHaveLength(0)
    })
})

describe('agents.create', () => {
    it('sends the defaults, the snake_case fields and the wire capabilities', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        await client(fetch).agents.create({
            name: 'Support',
            instructions: 'Answer from the docs.',
            scope: 'organization',
            capabilities: {
                indexedDocuments: { activation: 'always', sourceIds: [42] },
                memory: { activation: 'always', namespace: 'support' },
            },
            modelIds: ['mdl_1', 'mdl_2'],
        })

        expect(fetch.calls[0]!.method).toBe('POST')
        expect(fetch.calls[0]!.body).toEqual({
            name: 'Support',
            instructions: 'Answer from the docs.',
            scope: 'organization',
            allow_execution_options_override: false,
            capabilities: {
                indexed_documents: { activation: 'always', source_ids: [42], document_ids: '*' },
                memory: { activation: 'always', namespace: 'support' },
            },
            model_ids: ['mdl_1', 'mdl_2'],
        })
    })

    it('sends only the name, scope and flag when nothing else is given', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        await client(fetch).agents.create({ name: 'Bare' })
        expect(fetch.calls[0]!.body).toEqual({
            name: 'Bare',
            scope: 'private',
            allow_execution_options_override: false,
        })
    })

    it('names every problem at once', async () => {
        const fetch = mockFetch([])
        const error = await client(fetch)
            .agents.create({
                name: '',
                description: 'x'.repeat(501),
                scope: 'public' as never,
                capabilities: { web: { activation: 'sometimes' as never } },
                modelIds: [],
                model_ids: ['m'],
            } as never)
            .catch((e: unknown) => e)

        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual([
            'model_ids',
            'name',
            'description',
            'scope',
            'capabilities.web.activation',
            'modelIds',
        ])
        expect((error as InvalidParams).errors[0]!.message).toContain("use 'modelIds'")
        expect(fetch.calls).toHaveLength(0)
    })

    it('counts instructions in characters, as the API does', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        await client(fetch).agents.create({ name: 'A', instructions: '😀'.repeat(30_000) })
        expect(fetch.calls).toHaveLength(1)
        await expect(
            client(fetch).agents.create({ name: 'A', instructions: '😀'.repeat(30_001) }),
        ).rejects.toThrow(/at most 30000 characters, got 30001/)
    })
})

describe('agents.update', () => {
    it('sends only the fields passed, null clearing the clearable ones', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        await client(fetch).agents.update(AGENT, {
            description: null,
            capabilities: null,
            allowExecutionOptionsOverride: true,
        })
        expect(fetch.calls[0]!.method).toBe('PUT')
        expect(fetch.calls[0]!.url).toBe(`${API}/agents/${AGENT}`)
        expect(fetch.calls[0]!.body).toEqual({
            description: null,
            capabilities: null,
            allow_execution_options_override: true,
        })
    })

    it('merges a capabilities object key by key on the server', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        await client(fetch).agents.update(AGENT, {
            capabilities: { web: { activation: 'on_request' } },
        })
        expect(fetch.calls[0]!.body).toEqual({
            capabilities: { web: { activation: 'on_request' } },
        })
    })

    it('round-trips the capabilities it read', async () => {
        const wire = {
            indexed_documents: { activation: 'always', source_ids: [1], document_ids: '*' },
        }
        const fetch = mockFetch([
            jsonResponse(agentWire({ capabilities: wire })),
            jsonResponse(agentWire()),
        ])
        const agent = await client(fetch).agents.get(AGENT)
        await client(fetch).agents.update(AGENT, { capabilities: agent.capabilities })
        expect(fetch.calls[1]!.body).toEqual({ capabilities: wire })
    })

    it('refuses no field, and null on a field that cannot be cleared', async () => {
        const fetch = mockFetch([])
        await expect(client(fetch).agents.update(AGENT, {})).rejects.toThrow(/at least one of name/)
        const error = await client(fetch)
            .agents.update(AGENT, {
                name: null,
                scope: null,
                allowExecutionOptionsOverride: null,
            } as never)
            .catch((e: unknown) => e)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual([
            'name',
            'scope',
            'allowExecutionOptionsOverride',
        ])
        await expect(
            client(fetch).agents.update(AGENT, { modelIds: ['m'] } as never),
        ).rejects.toThrow(/modelIds: unknown key/)
        expect(fetch.calls).toHaveLength(0)
    })
})

describe('agents.setModels / delete', () => {
    it('replaces the model chain', async () => {
        const fetch = mockFetch([jsonResponse(agentWire())])
        await client(fetch).agents.setModels(AGENT, { modelIds: ['mdl_2', 'mdl_1'] })
        expect(fetch.calls[0]!.url).toBe(`${API}/agents/${AGENT}/models`)
        expect(fetch.calls[0]!.body).toEqual({ model_ids: ['mdl_2', 'mdl_1'] })
    })

    it('refuses an empty chain', async () => {
        const fetch = mockFetch([])
        await expect(client(fetch).agents.setModels(AGENT, { modelIds: [] })).rejects.toThrow(
            /at least one model/,
        )
        await expect(client(fetch).agents.setModels(AGENT, { modelIds: [''] })).rejects.toThrow(
            /modelIds\[0\]/,
        )
    })

    it('deletes an agent and surfaces a 404', async () => {
        const fetch = mockFetch([
            new Response(null, { status: 204 }),
            jsonResponse({ detail: 'Not Found' }, { status: 404 }),
        ])
        await client(fetch).agents.delete(AGENT)
        expect(fetch.calls[0]!.method).toBe('DELETE')
        await expect(client(fetch).agents.delete(AGENT)).rejects.toThrow(NotFoundError)
    })
})
