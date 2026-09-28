import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { NotFoundError } from '../errors.ts'
import { jsonResponse, mockFetch, startedThread, THREAD_ID, USER_ID } from '../test-utils.ts'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

describe('threads.list', () => {
    it('scopes to the client user id and paginates from zero', async () => {
        const fetch = mockFetch([jsonResponse([])])
        await client(fetch).threads.list()

        const url = new URL(fetch.calls[0]!.url)
        expect(url.pathname).toBe('/chat')
        expect(url.searchParams.get('user_id')).toBe(USER_ID)
        expect(url.searchParams.get('limit')).toBe('50')
        expect(url.searchParams.get('page')).toBe('0')
    })

    it('repeats the key for array params, as FastAPI expects', async () => {
        const fetch = mockFetch([jsonResponse([])])
        await client(fetch).threads.list({ terms: ['invoice', 'q3'] })

        const url = new URL(fetch.calls[0]!.url)
        expect(url.searchParams.getAll('terms')).toEqual(['invoice', 'q3'])
        expect(url.search).toContain('terms=invoice&terms=q3')
    })

    it('omits terms entirely when not searching', async () => {
        const fetch = mockFetch([jsonResponse([])])
        await client(fetch).threads.list({ limit: 10, page: 2 })
        expect(new URL(fetch.calls[0]!.url).searchParams.has('terms')).toBe(false)
    })
})

describe('threads.get / update / archive', () => {
    it('gets one thread with its messages', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        const thread = await client(fetch).threads.get(THREAD_ID)
        expect(fetch.calls[0]!.url).toBe(`https://ds.cominty.com/chat/${THREAD_ID}`)
        expect(thread.messages).toHaveLength(2)
    })

    it('sends only the fields being changed', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).threads.update(THREAD_ID, { starred: true })
        expect(fetch.calls[0]!.method).toBe('PUT')
        expect(fetch.calls[0]!.body).toEqual({ starred: true })
    })

    it('can set both name and starred', async () => {
        const fetch = mockFetch([jsonResponse(startedThread())])
        await client(fetch).threads.update(THREAD_ID, { name: 'Renamed', starred: false })
        expect(fetch.calls[0]!.body).toEqual({ name: 'Renamed', starred: false })
    })

    it('archives with DELETE', async () => {
        const fetch = mockFetch([new Response(null, { status: 204 })])
        await client(fetch).threads.archive(THREAD_ID)
        expect(fetch.calls[0]!.method).toBe('DELETE')
    })

    it('raises a typed error for a thread that does not exist', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'Thread not found' }, { status: 404 })])
        await expect(client(fetch).threads.get(THREAD_ID)).rejects.toThrow(NotFoundError)
    })
})
