import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { APIError, ConflictError, InvalidParams, NotFoundError } from '../errors.ts'
import { jsonResponse, memoryFile, mockFetch, USER_ID } from '../test-utils.ts'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

const NAMESPACE = 'brand-voice'
const VERSION = memoryFile().version

/** The arguments named by a rejected call's `InvalidParams`. */
async function rejected(call: Promise<unknown>): Promise<string[]> {
    const error = await call.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InvalidParams)
    return (error as InvalidParams).errors.map((e) => e.param)
}

describe('memory.list', () => {
    it('gets /memory with no query when no namespace is given', async () => {
        const fetch = mockFetch([jsonResponse([])])
        expect(await client(fetch).memory.list()).toEqual([])

        const call = fetch.calls[0]!
        expect(call.method).toBe('GET')
        expect(call.url).toBe('https://ds.cominty.com/memory')
        expect(call.body).toBeUndefined()
    })

    it('filters by namespace when one is given', async () => {
        const { content: _, ...summary } = memoryFile()
        const fetch = mockFetch([jsonResponse([summary])])
        const files = await client(fetch).memory.list({ namespace: NAMESPACE })

        const url = new URL(fetch.calls[0]!.url)
        expect(url.pathname).toBe('/memory')
        expect([...url.searchParams]).toEqual([['namespace', NAMESPACE]])
        expect(files).toEqual([summary])
    })

    it('rejects a namespace that is too long or not a string, before any request', async () => {
        const noCall = mockFetch([])
        const memory = client(noCall).memory
        expect(await rejected(memory.list({ namespace: 'n'.repeat(129) }))).toEqual(['namespace'])
        expect(await rejected(memory.list({ namespace: null as never }))).toEqual(['namespace'])
        expect(noCall.calls).toHaveLength(0)
    })
})

describe('memory.listNamespaces', () => {
    it('gets /memory/namespaces and returns the names', async () => {
        const fetch = mockFetch([jsonResponse(['brand-voice', `${USER_ID}::default`])])
        const names = await client(fetch).memory.listNamespaces()

        expect(fetch.calls[0]!.method).toBe('GET')
        expect(fetch.calls[0]!.url).toBe('https://ds.cominty.com/memory/namespaces')
        expect(names).toEqual(['brand-voice', `${USER_ID}::default`])
    })
})

describe('memory.create', () => {
    const file = {
        path: 'tone.md',
        namespace: NAMESPACE,
        purpose: 'writing style',
        content: 'Keep it casual.',
    }

    it('posts the file to /memory, namespace in the body', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile(), { status: 201 })])
        const created = await client(fetch).memory.create(file)

        const call = fetch.calls[0]!
        expect(call.method).toBe('POST')
        expect(call.url).toBe('https://ds.cominty.com/memory')
        expect(call.body).toEqual(file)
        expect(created.version).toBe(VERSION)
    })

    it('sends the four fields and nothing else', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile(), { status: 201 })])
        await client(fetch).memory.create({
            ...file,
            signal: new AbortController().signal,
            userId: USER_ID,
        } as never)
        expect(Object.keys(fetch.calls[0]!.body as object).sort()).toEqual([
            'content',
            'namespace',
            'path',
            'purpose',
        ])
    })

    it('accepts an empty content and one folder in the path', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile(), { status: 201 })])
        await client(fetch).memory.create({ ...file, path: 'preferences/tone.md', content: '' })
        expect(fetch.calls[0]!.body).toEqual({ ...file, path: 'preferences/tone.md', content: '' })
    })

    it('raises ConflictError when the path already exists in the namespace', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'File already exists' }, { status: 409 })])
        await expect(client(fetch).memory.create(file)).rejects.toThrow(ConflictError)
    })

    it('names every offending argument at once, before any request', async () => {
        const noCall = mockFetch([])
        const memory = client(noCall).memory
        expect(
            await rejected(
                memory.create({
                    path: 'a/b/tone.md',
                    namespace: 'n'.repeat(129),
                    purpose: 5,
                    content: null,
                } as never),
            ),
        ).toEqual(['path', 'namespace', 'purpose', 'content'])
        expect(await rejected(memory.create(undefined as never))).toEqual([
            'path',
            'namespace',
            'purpose',
            'content',
        ])
        expect(noCall.calls).toHaveLength(0)
    })

    it('requires a namespace', async () => {
        const { namespace: _, ...withoutNamespace } = file
        await expect(
            client(mockFetch([])).memory.create(withoutNamespace as never),
        ).rejects.toThrow('namespace: required, must be a string')
    })
})

describe('memory.get', () => {
    it('gets /memory/file with the path and namespace in the query', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile({ path: 'preferences/tone.md' }))])
        const file = await client(fetch).memory.get('preferences/tone.md', {
            namespace: NAMESPACE,
        })

        const call = fetch.calls[0]!
        const url = new URL(call.url)
        expect(call.method).toBe('GET')
        expect(url.pathname).toBe('/memory/file')
        expect([...url.searchParams]).toEqual([
            ['path', 'preferences/tone.md'],
            ['namespace', NAMESPACE],
        ])
        expect(call.body).toBeUndefined()
        expect(file.content).toBe('Keep it casual.')
    })

    it('does not trim a namespace, and sends an empty one as given', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile()), jsonResponse(memoryFile())])
        const memory = client(fetch).memory
        await memory.get('tone.md', { namespace: ' padded ' })
        await memory.get('tone.md', { namespace: '' })

        expect(new URL(fetch.calls[0]!.url).searchParams.get('namespace')).toBe(' padded ')
        expect(new URL(fetch.calls[1]!.url).search).toBe('?path=tone.md&namespace=')
    })

    it('accepts a namespace of 128 characters, counting an emoji as one', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile())])
        await client(fetch).memory.get('tone.md', { namespace: '😀'.repeat(128) })
        expect(fetch.calls).toHaveLength(1)
    })

    it('rejects a missing or oversized namespace, before any request', async () => {
        const noCall = mockFetch([])
        const memory = client(noCall).memory
        expect(await rejected(memory.get('tone.md', {} as never))).toEqual(['namespace'])
        // From plain JavaScript the whole second argument can be missing.
        expect(await rejected(memory.get('tone.md', undefined as never))).toEqual(['namespace'])
        expect(await rejected(memory.get('tone.md', { namespace: 'n'.repeat(129) }))).toEqual([
            'namespace',
        ])
        expect(noCall.calls).toHaveLength(0)
    })

    it('rejects a path more than one folder deep, before any request', async () => {
        const noCall = mockFetch([])
        await expect(
            client(noCall).memory.get('a/b/tone.md', { namespace: NAMESPACE }),
        ).rejects.toThrow(
            `path: must be at most one folder deep, like 'folder/file.md' (got "a/b/tone.md")`,
        )
        expect(noCall.calls).toHaveLength(0)
    })

    it('raises NotFoundError for a path that is not in the namespace', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'File not found' }, { status: 404 })])
        await expect(client(fetch).memory.get('tone.md', { namespace: NAMESPACE })).rejects.toThrow(
            NotFoundError,
        )
    })
})

describe('memory.update', () => {
    it('puts to /memory/file, naming the file in the query and the change in the body', async () => {
        const fetch = mockFetch([jsonResponse(memoryFile({ content: 'Keep it upbeat.' }))])
        const updated = await client(fetch).memory.update('tone.md', {
            namespace: NAMESPACE,
            version: VERSION,
            content: 'Keep it upbeat.',
        })

        const call = fetch.calls[0]!
        const url = new URL(call.url)
        expect(call.method).toBe('PUT')
        expect(url.pathname).toBe('/memory/file')
        // The version comes back out as it went in, `+` included.
        expect([...url.searchParams]).toEqual([
            ['path', 'tone.md'],
            ['namespace', NAMESPACE],
            ['version', VERSION],
        ])
        expect(call.body).toEqual({ content: 'Keep it upbeat.' })
        expect(updated.content).toBe('Keep it upbeat.')
    })

    it('sends only the fields that were passed', async () => {
        const fetch = mockFetch([
            jsonResponse(memoryFile()),
            jsonResponse(memoryFile()),
            jsonResponse(memoryFile()),
        ])
        const memory = client(fetch).memory
        const file = { namespace: NAMESPACE, version: VERSION }
        await memory.update('tone.md', { ...file, purpose: 'tone of voice' })
        await memory.update('tone.md', { ...file, content: '', purpose: 'tone of voice' })
        await memory.update('tone.md', { ...file, content: 'x', purpose: undefined })

        expect(fetch.calls[0]!.body).toEqual({ purpose: 'tone of voice' })
        expect(fetch.calls[1]!.body).toEqual({ content: '', purpose: 'tone of voice' })
        expect(Object.keys(fetch.calls[2]!.body as object)).toEqual(['content'])
    })

    it('needs at least one of content and purpose', async () => {
        const noCall = mockFetch([])
        await expect(
            client(noCall).memory.update('tone.md', { namespace: NAMESPACE, version: VERSION }),
        ).rejects.toThrow('content or purpose: at least one is required')
        expect(noCall.calls).toHaveLength(0)
    })

    it('rejects an explicit null, which the API would ignore and still answer 200', async () => {
        const noCall = mockFetch([])
        const memory = client(noCall).memory
        const file = { namespace: NAMESPACE, version: VERSION }

        await expect(memory.update('tone.md', { ...file, content: null as never })).rejects.toThrow(
            /content: cannot be null/,
        )
        expect(
            await rejected(
                memory.update('tone.md', { ...file, content: 'x', purpose: null as never }),
            ),
        ).toEqual(['purpose'])
        expect(
            await rejected(
                memory.update('tone.md', { ...file, content: null, purpose: null } as never),
            ),
        ).toEqual(['content', 'purpose'])
        expect(noCall.calls).toHaveLength(0)
    })

    it('requires a namespace and a version, and checks the path', async () => {
        const noCall = mockFetch([])
        expect(
            await rejected(client(noCall).memory.update('a/b/tone.md', { content: 'x' } as never)),
        ).toEqual(['path', 'namespace', 'version'])
        expect(noCall.calls).toHaveLength(0)
    })

    it('raises ConflictError for a stale version', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'Version conflict' }, { status: 409 })])
        await expect(
            client(fetch).memory.update('tone.md', {
                namespace: NAMESPACE,
                version: VERSION,
                content: 'x',
            }),
        ).rejects.toThrow(ConflictError)
    })

    it('leaves a malformed version to the API: a 422 stays a plain APIError', async () => {
        const detail = [{ loc: ['query', 'version'], msg: 'Input should be a valid datetime' }]
        const fetch = mockFetch([jsonResponse({ detail }, { status: 422 })])
        const error = await client(fetch)
            .memory.update('tone.md', {
                namespace: NAMESPACE,
                version: 'not-a-version',
                content: 'x',
            })
            .catch((e: unknown) => e)

        expect(fetch.calls).toHaveLength(1)
        expect(error).toBeInstanceOf(APIError)
        expect(error).not.toBeInstanceOf(ConflictError)
        expect((error as APIError).status).toBe(422)
    })
})

describe('memory.delete', () => {
    it('deletes /memory/file and resolves to nothing on the 204', async () => {
        const fetch = mockFetch([new Response(null, { status: 204 })])
        const result = await client(fetch).memory.delete('tone.md', { namespace: NAMESPACE })

        const call = fetch.calls[0]!
        const url = new URL(call.url)
        expect(call.method).toBe('DELETE')
        expect(url.pathname).toBe('/memory/file')
        expect([...url.searchParams]).toEqual([
            ['path', 'tone.md'],
            ['namespace', NAMESPACE],
        ])
        expect(call.body).toBeUndefined()
        expect(result).toBeUndefined()
    })

    it('is not idempotent: a path already gone raises NotFoundError', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'File not found' }, { status: 404 })])
        await expect(
            client(fetch).memory.delete('tone.md', { namespace: NAMESPACE }),
        ).rejects.toThrow(NotFoundError)
    })

    it('checks the path and the namespace before any request', async () => {
        const noCall = mockFetch([])
        const memory = client(noCall).memory
        expect(await rejected(memory.delete('a/b/tone.md', undefined as never))).toEqual([
            'path',
            'namespace',
        ])
        expect(noCall.calls).toHaveLength(0)
    })
})

describe('client.memory', () => {
    const calls = (memory: Cominty['memory'], signal?: AbortSignal) => [
        () => memory.list({ namespace: NAMESPACE, signal }),
        () => memory.listNamespaces({ signal }),
        () =>
            memory.create({
                path: 'tone.md',
                namespace: NAMESPACE,
                purpose: 'writing style',
                content: 'Keep it casual.',
                signal,
            }),
        () => memory.get('tone.md', { namespace: NAMESPACE, signal }),
        () =>
            memory.update('tone.md', {
                namespace: NAMESPACE,
                version: VERSION,
                content: 'x',
                signal,
            }),
        () => memory.delete('tone.md', { namespace: NAMESPACE, signal }),
    ]

    it('never sends the client user id', async () => {
        const fetch = mockFetch(Array.from({ length: 6 }, () => () => jsonResponse(memoryFile())))
        for (const call of calls(client(fetch).memory)) await call()

        expect(fetch.calls).toHaveLength(6)
        for (const call of fetch.calls) {
            expect(new URL(call.url).searchParams.has('user_id')).toBe(false)
            expect(JSON.stringify(call.body ?? {})).not.toContain(USER_ID)
        }
    })

    it('hands the caller signal to every request', async () => {
        // Behaves like the real fetch: an aborted signal rejects the request.
        const fetch: typeof globalThis.fetch = async (_input, init) => {
            init?.signal?.throwIfAborted()
            return jsonResponse(memoryFile())
        }
        for (const call of calls(client(fetch).memory, AbortSignal.abort())) {
            await expect(call()).rejects.toMatchObject({ name: 'AbortError' })
        }
    })
})
