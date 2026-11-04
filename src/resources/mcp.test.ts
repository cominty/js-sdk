import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { InvalidParams, NotFoundError, SDKError } from '../errors.ts'
import { jsonResponse, mcpServer, mockFetch, USER_ID } from '../test-utils.ts'

const API = 'https://ds.cominty.com'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

const manifest = () =>
    jsonResponse({
        servers: [
            mcpServer(),
            mcpServer({ name: 'slack', is_enabled: false }),
            mcpServer({ name: 'notion' }),
        ],
    })

describe('mcp.list', () => {
    it('keeps the enabled servers by default', async () => {
        const fetch = mockFetch([manifest()])
        const servers = await client(fetch).mcp.list()
        expect(servers.map((s) => s.name)).toEqual(['linear', 'notion'])
        expect(fetch.calls[0]!.url).toBe(`${API}/mcp/manifest`)
    })

    it('keeps the disabled ones with enabled: false, and every one with null', async () => {
        const fetch = mockFetch([manifest(), manifest()])
        expect((await client(fetch).mcp.list({ enabled: false })).map((s) => s.name)).toEqual([
            'slack',
        ])
        expect((await client(fetch).mcp.list({ enabled: null })).map((s) => s.name)).toEqual([
            'linear',
            'slack',
            'notion',
        ])
    })

    it('refuses a non-boolean filter, and a manifest without servers', async () => {
        const fetch = mockFetch([jsonResponse({})])
        await expect(client(fetch).mcp.list({ enabled: 'yes' as never })).rejects.toThrow(
            InvalidParams,
        )
        await expect(client(fetch).mcp.list()).rejects.toThrow(SDKError)
    })
})

describe('documents.get', () => {
    it('sends the composite id URL-encoded in the query', async () => {
        const metadata = {
            document_id: 'src_1#doc 1',
            source_id: 42,
            source_pid: 'src_1',
            source_type: 'draganddrop',
            document_name: 'faq.md',
            document_uri: null,
            document_extension: 'md',
            document_mime_type: 'text/markdown',
        }
        const fetch = mockFetch([jsonResponse(metadata)])
        const document = await client(fetch).documents.get('src_1#doc 1')
        expect(document.source_pid).toBe('src_1')
        expect(fetch.calls[0]!.url).toBe(`${API}/documents?id=src_1%23doc+1`)
    })

    it('refuses an empty id, and surfaces an unknown one', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'Not Found' }, { status: 404 })])
        await expect(client(fetch).documents.get('')).rejects.toThrow(/documentId: required/)
        await expect(client(fetch).documents.get('nope')).rejects.toThrow(NotFoundError)
    })
})
