import { describe, expect, it } from 'vitest'
import { Cominty } from '../client.ts'
import { APIError, type InvalidParams } from '../errors.ts'
import { SKILL_MAX_BYTES } from '../models/skills.ts'
import { jsonResponse, mockFetch, skill, USER_ID } from '../test-utils.ts'
import { crc32 } from '../zip.ts'

const API = 'https://ds.cominty.com'
const SKILL_MD = '---\nname: release-notes\ndescription: Drafts release notes\n---\nBody'

function client(fetch: typeof globalThis.fetch) {
    return new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
}

/** Read back the stored entries of a zip: name to text. */
function unzip(bytes: Uint8Array): Record<string, string> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: Record<string, string> = {}
    let at = 0
    while (view.getUint32(at, true) === 0x04034b50) {
        expect(view.getUint16(at + 8, true)).toBe(0) // stored
        const crc = view.getUint32(at + 14, true)
        const size = view.getUint32(at + 18, true)
        const nameLength = view.getUint16(at + 26, true)
        const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength))
        const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size)
        expect(crc32(data)).toBe(crc)
        entries[name] = new TextDecoder().decode(data)
        at += 30 + nameLength + size
    }
    return entries
}

async function sentArchive(
    rawBody: unknown,
): Promise<{ file: File; fields: Record<string, string> }> {
    const form = rawBody as FormData
    const fields: Record<string, string> = {}
    for (const [key, value] of form.entries()) if (typeof value === 'string') fields[key] = value
    return { file: form.get('file') as File, fields }
}

describe('crc32', () => {
    it('matches the standard check value', () => {
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    })
})

describe('skills.list', () => {
    it('lists the visible skills', async () => {
        const fetch = mockFetch([
            jsonResponse([skill(), skill({ id: 'skl_2', source: 'cominty' })]),
        ])
        const skills = await client(fetch).skills.list()
        expect(skills.map((s) => s.source)).toEqual(['custom', 'cominty'])
        expect(fetch.calls[0]!.url).toBe(`${API}/skills`)
    })
})

describe('skills.create', () => {
    it('zips a files object in memory and posts it as multipart with the token', async () => {
        const fetch = mockFetch([jsonResponse(skill(), { status: 201 })])
        await client(fetch).skills.create(
            {
                'SKILL.md': SKILL_MD,
                'scripts/run.py': new TextEncoder().encode('print(1)'),
                'notes.txt': new Blob(['notes']),
                '.env': 'SECRET=1',
                'assets/.cache/x': 'hidden',
            },
            { displayName: 'Release notes', scope: 'organization' },
        )

        const call = fetch.calls[0]!
        expect(call.method).toBe('POST')
        expect(call.url).toBe(`${API}/skills`)
        expect(call.headers['x-cominty-token']).toBe('ck_live_test')
        // fetch sets the multipart content type, boundary included.
        expect(call.headers['content-type']).toBeUndefined()
        const { file, fields } = await sentArchive(call.rawBody)
        expect(fields).toEqual({ display_name: 'Release notes', scope: 'organization' })
        expect(file.name).toBe('skill.zip')
        expect(file.type).toBe('application/zip')
        expect(unzip(new Uint8Array(await file.arrayBuffer()))).toEqual({
            'SKILL.md': SKILL_MD,
            'notes.txt': 'notes',
            'scripts/run.py': 'print(1)',
        })
    })

    it('sends a zip as it is, keeping a File name', async () => {
        const fetch = mockFetch([jsonResponse(skill()), jsonResponse(skill())])
        const bytes = new Uint8Array([0x50, 0x4b, 3, 4])
        await client(fetch).skills.create(bytes, { displayName: 'A' })
        await client(fetch).skills.create(new File([bytes], 'mine.zip'), { displayName: 'A' })

        const first = await sentArchive(fetch.calls[0]!.rawBody)
        expect(first.fields.scope).toBe('private')
        expect(first.file.name).toBe('skill.zip')
        expect(new Uint8Array(await first.file.arrayBuffer())).toEqual(bytes)
        expect((await sentArchive(fetch.calls[1]!.rawBody)).file.name).toBe('mine.zip')
    })

    it('refuses a files object without SKILL.md, or with a bad path', async () => {
        const fetch = mockFetch([])
        await expect(
            client(fetch).skills.create({ 'README.md': 'x' }, { displayName: 'A' }),
        ).rejects.toThrow(/has no 'SKILL.md' at its root/)
        const error = await client(fetch)
            .skills.create(
                { 'SKILL.md': SKILL_MD, '../up': 'x', '/abs': 'x', 'n.bin': 3 as never },
                { displayName: 'A' },
            )
            .catch((e: unknown) => e)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual([
            "file['../up']",
            "file['/abs']",
            "file['n.bin']",
        ])
        expect(fetch.calls).toHaveLength(0)
    })

    it('refuses a string, an oversized archive and a bad display name', async () => {
        const fetch = mockFetch([])
        await expect(
            client(fetch).skills.create('./skill' as never, { displayName: 'A' }),
        ).rejects.toThrow(/ambiguous between a path and content/)
        await expect(
            client(fetch).skills.create(new Uint8Array(SKILL_MAX_BYTES + 1), { displayName: 'A' }),
        ).rejects.toThrow(/over the 31457280 bytes/)
        await expect(
            client(fetch).skills.create(new Uint8Array(1), { displayName: 'x'.repeat(101) }),
        ).rejects.toThrow(/displayName: must be 1 to 100 characters, got 101/)
        await expect(
            client(fetch).skills.create(new Uint8Array(1), { display_name: 'A' } as never),
        ).rejects.toThrow(/use 'displayName'/)
        expect(fetch.calls).toHaveLength(0)
    })

    it('surfaces a frontmatter refusal as the API error', async () => {
        const fetch = mockFetch([jsonResponse({ detail: 'missing description' }, { status: 422 })])
        await expect(
            client(fetch).skills.create({ 'SKILL.md': '---\n---' }, { displayName: 'A' }),
        ).rejects.toThrow(APIError)
    })
})

describe('skills.update / uploadVersion / delete', () => {
    it('sends only the fields passed', async () => {
        const fetch = mockFetch([jsonResponse(skill({ active: false }))])
        await client(fetch).skills.update('skl_1', { active: false })
        expect(fetch.calls[0]!.method).toBe('PUT')
        expect(fetch.calls[0]!.url).toBe(`${API}/skills/skl_1`)
        expect(fetch.calls[0]!.body).toEqual({ active: false })
    })

    it('refuses an update with no field or a bad one', async () => {
        const fetch = mockFetch([])
        await expect(client(fetch).skills.update('skl_1', {})).rejects.toThrow(
            /at least one of displayName, active or scope/,
        )
        const error = await client(fetch)
            .skills.update('skl_1', { active: 'yes' as never, scope: 'team' as never })
            .catch((e: unknown) => e)
        expect((error as InvalidParams).errors.map((e) => e.param)).toEqual(['active', 'scope'])
    })

    it('uploads a version as multipart with only the file', async () => {
        const fetch = mockFetch([jsonResponse(skill(), { status: 201 })])
        await client(fetch).skills.uploadVersion('skl_1', { 'SKILL.md': SKILL_MD })
        expect(fetch.calls[0]!.url).toBe(`${API}/skills/skl_1/versions`)
        const { file, fields } = await sentArchive(fetch.calls[0]!.rawBody)
        expect(fields).toEqual({})
        expect(unzip(new Uint8Array(await file.arrayBuffer()))).toEqual({ 'SKILL.md': SKILL_MD })
    })

    it('deletes a skill', async () => {
        const fetch = mockFetch([new Response(null, { status: 204 })])
        await client(fetch).skills.delete('skl_1')
        expect(fetch.calls[0]!.method).toBe('DELETE')
        expect(fetch.calls[0]!.url).toBe(`${API}/skills/skl_1`)
        await expect(client(fetch).skills.delete('')).rejects.toThrow(/skillId: required/)
    })
})
