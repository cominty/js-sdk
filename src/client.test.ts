import { afterEach, describe, expect, it } from 'vitest'
import { Cominty } from './client.ts'
import { DEFAULT_BASE_URL } from './config.ts'
import { mockFetch, USER_ID } from './test-utils.ts'

const ENV_KEYS = ['COMINTY_API_KEY', 'COMINTY_USER_ID', 'COMINTY_BASE_URL'] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
    }
})

const fetch = mockFetch([])

describe('Cominty', () => {
    it('reads credentials from the environment', () => {
        process.env.COMINTY_API_KEY = 'ck_live_env'
        process.env.COMINTY_USER_ID = USER_ID
        const client = new Cominty({ fetch })
        expect(client.userId).toBe(USER_ID)
        expect(client.baseUrl).toBe(DEFAULT_BASE_URL)
    })

    it('prefers explicit arguments over the environment', () => {
        process.env.COMINTY_BASE_URL = 'https://from-env.example'
        const client = new Cominty({
            apiToken: 'ck_live_test',
            userId: USER_ID,
            baseUrl: 'https://explicit.example',
            fetch,
        })
        expect(client.baseUrl).toBe('https://explicit.example')
    })

    it('strips a trailing slash from the base URL', () => {
        const client = new Cominty({
            apiToken: 'ck_live_test',
            userId: USER_ID,
            baseUrl: 'https://api.example.com/',
            fetch,
        })
        expect(client.baseUrl).toBe('https://api.example.com')
    })

    it('treats an empty env var as unset', () => {
        process.env.COMINTY_API_KEY = ''
        process.env.COMINTY_USER_ID = USER_ID
        expect(() => new Cominty({ fetch })).toThrow(/apiToken is required/)
    })

    it('names the missing credential and how to supply it', () => {
        delete process.env.COMINTY_API_KEY
        delete process.env.COMINTY_USER_ID
        expect(() => new Cominty({ fetch })).toThrow(/COMINTY_API_KEY/)
        expect(() => new Cominty({ apiToken: 'ck_live_test', fetch })).toThrow(/COMINTY_USER_ID/)
    })

    it('rejects a malformed user id at construction, not on the first call', () => {
        expect(() => new Cominty({ apiToken: 'ck_live_test', userId: 'nope', fetch })).toThrow(
            /invalid userId/,
        )
        expect(
            () => new Cominty({ apiToken: 'ck_live_test', userId: 'user_short', fetch }),
        ).toThrow(/invalid userId/)
    })

    it('points at the platform when the user id is wrong', () => {
        expect(() => new Cominty({ apiToken: 'ck_live_test', userId: 'x', fetch })).toThrow(
            /platform\.cominty\.ai/,
        )
    })

    it('exposes chat and threads resources', () => {
        const client = new Cominty({ apiToken: 'ck_live_test', userId: USER_ID, fetch })
        expect(client.chat).toBeDefined()
        expect(client.threads).toBeDefined()
    })
})
