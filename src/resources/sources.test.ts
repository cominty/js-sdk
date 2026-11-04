import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import {
    APIError,
    InvalidParams,
    NotFoundError,
    SDKError,
    SourceSyncFailed,
    SourceSyncTimeout,
} from '../errors.ts'
import {
    bytesResponse,
    DRIVE_ID,
    jsonResponse,
    mockFetch,
    source,
    SOURCE_PID,
    sourceFile,
    stalledResponse,
    storageAccepted,
    uploadPermission,
    USER_ID,
} from '../test-utils.ts'

const API = 'https://ds.cominty.com'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

/** The four responses of one presigned upload into the drive. */
function uploadResponses(file = sourceFile()) {
    return [jsonResponse(uploadPermission()), storageAccepted(), jsonResponse(file)]
}

describe('sources.create', () => {
    it('creates a drive, uploads every file, then creates a private drag-and-drop source', async () => {
        const fetch = mockFetch([
            jsonResponse({ id: DRIVE_ID, files: [] }),
            ...uploadResponses(sourceFile({ name: 'faq.md' })),
            ...uploadResponses(sourceFile({ id: 'fil_2', name: 'notes.txt' })),
            jsonResponse(source()),
        ])
        const created = await client(fetch).sources.create(
            [
                new File(['# FAQ'], 'faq.md'),
                { filename: 'notes.txt', content: new TextEncoder().encode('hi') },
            ],
            { name: 'Product docs' },
        )

        expect(created.pid).toBe(SOURCE_PID)
        expect(fetch.calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
            `POST ${API}/drives`,
            `GET ${API}/drives/${DRIVE_ID}/upload`,
            'POST https://bucket.example/upload',
            `POST ${API}/drives/upload`,
            `GET ${API}/drives/${DRIVE_ID}/upload`,
            'POST https://bucket.example/upload',
            `POST ${API}/drives/upload`,
            `POST ${API}/dc/sources`,
        ])
        const permission = new URL(fetch.calls[1]!.url)
        expect(permission.searchParams.get('filename')).toBe('faq.md')
        expect(permission.searchParams.get('mimetype')).toBe('text/markdown')
        expect(new URL(fetch.calls[4]!.url).searchParams.get('mimetype')).toBe('text/plain')
        expect(fetch.calls[3]!.body).toEqual({ etag: '"etag-1"', key: 'uploads/key' })
        expect(fetch.calls.at(-1)!.body).toEqual({
            name: 'Product docs',
            store: 'draganddrop',
            scope: 'private',
            config: { drive_id: DRIVE_ID },
        })
    })

    it('never sends the API key to the storage backend', async () => {
        const fetch = mockFetch([
            jsonResponse({ id: DRIVE_ID, files: [] }),
            ...uploadResponses(),
            jsonResponse(source()),
        ])
        await client(fetch).sources.create(new File(['x'], 'faq.md'))

        const storage = fetch.calls[2]!
        expect(storage.headers['x-cominty-token']).toBeUndefined()
        expect(storage.rawBody).toBeInstanceOf(FormData)
        expect(fetch.calls.at(-1)!.body).not.toHaveProperty('name')
    })

    it('checks every file before any request', async () => {
        const fetch = mockFetch([])
        const error = await client(fetch)
            .sources.create([
                new File(['a'], 'same.md'),
                new File(['b'], 'same.md'),
                'a path' as never,
                { filename: 'a/b.md', content: new Uint8Array(1) },
                new Blob(['no name']) as never,
            ])
            .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(InvalidParams)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual([
            'files[1].filename',
            'files[2]',
            'files[2].filename',
            'files[3].filename',
            'files[4].filename',
        ])
        expect(fetch.calls).toHaveLength(0)
    })

    it('refuses an empty list and more than 50 files', async () => {
        const fetch = mockFetch([])
        await expect(client(fetch).sources.create([])).rejects.toThrow(/at least one file/)
        const many = Array.from({ length: 51 }, (_, i) => new File(['x'], `f${i}.md`))
        await expect(client(fetch).sources.create(many)).rejects.toThrow(
            /at most 50 files, this would make 51/,
        )
        await expect(
            client(fetch).sources.create(new File(['x'], 'a.md'), { name: 3 as never }),
        ).rejects.toThrow(InvalidParams)
        expect(fetch.calls).toHaveLength(0)
    })

    it('keeps the presigned signature out of a bad permission error', async () => {
        const fetch = mockFetch([
            jsonResponse({ id: DRIVE_ID, files: [] }),
            jsonResponse({ url: 'https://bucket.example/?sig=secret', fields: {} }),
        ])
        const error = await client(fetch)
            .sources.create(new File(['x'], 'a.md'))
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(SDKError)
        expect((error as Error).message).toContain(`GET /drives/${DRIVE_ID}/upload`)
        expect((error as Error).message).not.toContain('secret')
    })
})

describe('sources.list / get / update', () => {
    it('lists the visible sources', async () => {
        const fetch = mockFetch([jsonResponse([source(), source({ pid: 'other' })])])
        const sources = await client(fetch).sources.list()
        expect(sources.map((s) => s.pid)).toEqual([SOURCE_PID, 'other'])
        expect(fetch.calls[0]!.url).toBe(`${API}/dc/sources`)
    })

    it('gets a source by listing and picking', async () => {
        const fetch = mockFetch([jsonResponse([source({ pid: 'other' }), source()])])
        expect((await client(fetch).sources.get(SOURCE_PID)).id).toBe(42)
    })

    it('throws NotFoundError when no visible source has the pid', async () => {
        const fetch = mockFetch([jsonResponse([source()])])
        const error = await client(fetch)
            .sources.get('missing')
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(NotFoundError)
        expect((error as NotFoundError).status).toBe(404)
    })

    it('renames a source', async () => {
        const fetch = mockFetch([jsonResponse(source({ name: 'Renamed' }))])
        await client(fetch).sources.update('a/b', { name: 'Renamed' })
        expect(fetch.calls[0]!.method).toBe('PUT')
        expect(fetch.calls[0]!.url).toBe(`${API}/dc/sources/a%2Fb`)
        expect(fetch.calls[0]!.body).toEqual({ name: 'Renamed' })
    })

    it('requires a name and a pid', async () => {
        const fetch = mockFetch([])
        await expect(client(fetch).sources.update(SOURCE_PID, {} as never)).rejects.toThrow(
            /name: required/,
        )
        await expect(client(fetch).sources.get('')).rejects.toThrow(/sourcePid: required/)
    })
})

describe('sources.addFiles / listFiles / removeFile', () => {
    it('uploads into the drive and requests a sync when the source accepts one', async () => {
        const fetch = mockFetch([
            jsonResponse([source({ status: 'synced' })]),
            jsonResponse({ id: DRIVE_ID, files: [sourceFile()] }),
            ...uploadResponses(sourceFile({ id: 'fil_2', name: 'new.md' })),
            jsonResponse(source({ status: 'syncing' })),
        ])
        const added = await client(fetch).sources.addFiles(SOURCE_PID, new File(['x'], 'new.md'))

        expect(added.map((f) => f.id)).toEqual(['fil_2'])
        expect(fetch.calls[1]!.url).toBe(`${API}/drives/${DRIVE_ID}`)
        const sync = fetch.calls.at(-1)!
        expect(sync.method).toBe('PUT')
        expect(sync.url).toBe(`${API}/dc/sources/${SOURCE_PID}/status?operation=sync`)
    })

    it('leaves the files to a sync already running', async () => {
        const fetch = mockFetch([
            jsonResponse([source({ status: 'syncing' })]),
            jsonResponse({ id: DRIVE_ID, files: [] }),
            ...uploadResponses(),
        ])
        await client(fetch).sources.addFiles(SOURCE_PID, [new File(['x'], 'a.md')])
        expect(fetch.calls).toHaveLength(5)
    })

    it('counts the files already in the source against the cap', async () => {
        const existing = Array.from({ length: 49 }, (_, i) => sourceFile({ id: `f${i}` }))
        const fetch = mockFetch([
            jsonResponse([source()]),
            jsonResponse({ id: DRIVE_ID, files: existing }),
        ])
        await expect(
            client(fetch).sources.addFiles(SOURCE_PID, [
                new File(['x'], 'a.md'),
                new File(['y'], 'b.md'),
            ]),
        ).rejects.toThrow(/this would make 51/)
        expect(fetch.calls).toHaveLength(2)
    })

    it('refuses a connected source, which has no drive', async () => {
        const fetch = mockFetch([jsonResponse([source({ store: 'googledrive', config: {} })])])
        await expect(client(fetch).sources.listFiles(SOURCE_PID)).rejects.toThrow(
            /only drag-and-drop sources hold files/,
        )
    })

    it('lists the files of a drive, flat config or nested', async () => {
        const fetch = mockFetch([
            jsonResponse([source({ config: { drive_id: DRIVE_ID } })]),
            jsonResponse({ id: DRIVE_ID, files: [sourceFile()] }),
        ])
        expect(await client(fetch).sources.listFiles(SOURCE_PID)).toEqual([sourceFile()])
    })

    it('deletes a file, then syncs', async () => {
        const fetch = mockFetch([
            jsonResponse([source({ status: 'error' })]),
            new Response(null, { status: 204 }),
            jsonResponse(source()),
        ])
        await client(fetch).sources.removeFile(SOURCE_PID, 'fil_1')
        expect(fetch.calls[1]!.method).toBe('DELETE')
        expect(fetch.calls[1]!.url).toBe(`${API}/files/fil_1`)
        expect(fetch.calls[2]!.url).toContain('operation=sync')
    })

    it('downloads a file through its presigned URL', async () => {
        const fetch = mockFetch([
            jsonResponse('https://bucket.example/faq.md?sig=secret'),
            bytesResponse(new TextEncoder().encode('# FAQ')),
        ])
        const bytes = await client(fetch).sources.downloadFile('fil_1')
        expect(new TextDecoder().decode(bytes)).toBe('# FAQ')
        expect(fetch.calls[1]!.headers['x-cominty-token']).toBeUndefined()
        await expect(client(fetch).sources.downloadFile('')).rejects.toThrow(/sources.downloadFile/)
    })
})

describe('sources status operations', () => {
    for (const operation of ['start', 'pause', 'sync', 'archive'] as const) {
        it(`${operation} sends PUT /dc/sources/{pid}/status?operation=${operation}`, async () => {
            const fetch = mockFetch([jsonResponse(source())])
            await client(fetch).sources[operation](SOURCE_PID)
            expect(fetch.calls[0]!.method).toBe('PUT')
            expect(fetch.calls[0]!.url).toBe(
                `${API}/dc/sources/${SOURCE_PID}/status?operation=${operation}`,
            )
        })
    }

    it('surfaces an invalid operation as the API error', async () => {
        const fetch = mockFetch([
            jsonResponse({ detail: 'Operation is not valid' }, { status: 400 }),
        ])
        await expect(client(fetch).sources.start(SOURCE_PID)).rejects.toThrow(APIError)
    })
})

describe('sources.waitSynced', () => {
    it('polls until the source is synced', async () => {
        const fetch = mockFetch([
            jsonResponse([source({ status: 'pending' })]),
            jsonResponse([source({ status: 'syncing' })]),
            jsonResponse([source({ status: 'synced' })]),
        ])
        const ready = await client(fetch).sources.waitSynced(SOURCE_PID, { interval: 0 })
        expect(ready.status).toBe('synced')
        expect(fetch.calls).toHaveLength(3)
    })

    it('throws SourceSyncFailed with the source when it stops elsewhere', async () => {
        const fetch = mockFetch([jsonResponse([source({ status: 'error' })])])
        const error = await client(fetch)
            .sources.waitSynced(SOURCE_PID, { interval: 0 })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(SourceSyncFailed)
        expect((error as SourceSyncFailed).source.status).toBe('error')
    })

    it('throws SourceSyncTimeout with the last source read', async () => {
        const fetch = mockFetch(
            Array.from({ length: 50 }, () => jsonResponse([source({ status: 'syncing' })])),
        )
        const error = await client(fetch)
            .sources.waitSynced(SOURCE_PID, { timeout: 30, interval: 5 })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(SourceSyncTimeout)
        expect((error as SourceSyncTimeout).source?.status).toBe('syncing')
    })

    it('cuts a read that hangs past the timeout', async () => {
        const fetch = mockFetch([stalledResponse])
        const error = await client(fetch)
            .sources.waitSynced(SOURCE_PID, { timeout: 10 })
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(SourceSyncTimeout)
        expect((error as SourceSyncTimeout).source).toBeNull()
    })

    it("rejects with the caller's own abort, not a timeout", async () => {
        const fetch = mockFetch([jsonResponse([source({ status: 'syncing' })]), stalledResponse])
        const controller = new AbortController()
        const waiting = client(fetch).sources.waitSynced(SOURCE_PID, {
            interval: 0,
            signal: controller.signal,
        })
        setTimeout(() => controller.abort(), 5)
        const error = await waiting.catch((e: unknown) => e)
        expect(error).not.toBeInstanceOf(SourceSyncTimeout)
        expect((error as Error).name).toBe('AbortError')
    })

    it('rejects at once when the signal is already aborted', async () => {
        const fetch = mockFetch([])
        const error = await client(fetch)
            .sources.waitSynced(SOURCE_PID, { signal: AbortSignal.abort() })
            .catch((e: unknown) => e)
        expect((error as Error).name).toBe('AbortError')
        expect(fetch.calls).toHaveLength(0)
    })

    it('refuses a negative or non-numeric timing', async () => {
        const fetch = mockFetch([])
        await expect(
            client(fetch).sources.waitSynced(SOURCE_PID, {
                timeout: -1,
                interval: 'x' as never,
            }),
        ).rejects.toThrow(/timeout[\s\S]*interval/)
    })
})
