import { describe, expect, it } from 'vitest'
import {
    APIError,
    AuthError,
    ConflictError,
    errorFromResponse,
    InvalidParams,
    NotFoundError,
    PermissionError,
    RateLimitError,
    ServerError,
} from './errors.ts'

describe('errorFromResponse', () => {
    it('maps each status onto its class', () => {
        expect(errorFromResponse(401, {})).toBeInstanceOf(AuthError)
        expect(errorFromResponse(403, {})).toBeInstanceOf(PermissionError)
        expect(errorFromResponse(404, {})).toBeInstanceOf(NotFoundError)
        expect(errorFromResponse(409, {})).toBeInstanceOf(ConflictError)
        expect(errorFromResponse(429, {})).toBeInstanceOf(RateLimitError)
        expect(errorFromResponse(500, {})).toBeInstanceOf(ServerError)
        expect(errorFromResponse(503, {})).toBeInstanceOf(ServerError)
    })

    it('falls back to APIError for an unmapped 4xx', () => {
        const error = errorFromResponse(418, {})
        expect(error).toBeInstanceOf(APIError)
        expect(error).not.toBeInstanceOf(ServerError)
        expect(error.status).toBe(418)
    })

    it("uses FastAPI's detail string as the message", () => {
        expect(errorFromResponse(404, { detail: 'Thread not found' }).message).toBe(
            'Thread not found',
        )
    })

    it('keeps the raw body and a structured detail', () => {
        const body = { detail: [{ loc: ['body', 'message'], msg: 'field required' }] }
        const error = errorFromResponse(422, body)
        expect(error.body).toEqual(body)
        expect(Array.isArray(error.detail)).toBe(true)
    })

    it('falls back to the status when there is no detail', () => {
        expect(errorFromResponse(500, null).message).toBe('HTTP 500')
    })
})

describe('RateLimitError', () => {
    it('explains an organization quota and what to do about it', () => {
        const error = errorFromResponse(429, {
            detail: { quota_reached: 'organization', reset_at: '2026-09-15T00:00:00Z' },
        }) as RateLimitError

        expect(error.scope).toBe('organization')
        expect(error.message).toContain('Organization rate limit reached')
        expect(error.message).toContain('organization admin')
        expect(error.message).toContain('Quota resets at')
        expect(error.resetAt?.toISOString()).toBe('2026-09-15T00:00:00.000Z')
    })

    it('distinguishes the transient concurrency cap from an exhausted quota', () => {
        const error = errorFromResponse(429, {
            detail: 'Too many concurrent requests',
        }) as RateLimitError

        expect(error.scope).toBe('concurrency')
        expect(error.message).toContain('simultaneous chat sessions')
        expect(error.message).toContain('retry')
    })

    it('reads Retry-After off the headers', () => {
        const headers = new Headers({ 'retry-after': '30' })
        const error = errorFromResponse(429, { detail: 'slow down' }, headers) as RateLimitError
        expect(error.retryAfter).toBe(30)
        expect(error.message).toContain('retry in 30s')
    })

    it('survives a scope name this version does not know', () => {
        const error = errorFromResponse(429, {
            detail: { quota_reached: 'project' },
        }) as RateLimitError
        expect(error.scope).toBe('project')
        expect(error.message).toContain('Project rate limit reached')
    })

    it('reports no scope when the server says nothing useful', () => {
        expect((errorFromResponse(429, null) as RateLimitError).scope).toBeNull()
        expect((errorFromResponse(429, null) as RateLimitError).retryAfter).toBeNull()
    })
})

describe('InvalidParams', () => {
    const got = (input: unknown) =>
        new InvalidParams('chat.start', [
            { param: 'maxSteps', message: 'must be an integer', input },
        ]).message

    it('names the call, the argument and the bad value', () => {
        expect(got('5')).toBe(
            'Invalid parameters for chat.start:\n  - maxSteps: must be an integer (got "5")',
        )
    })

    it('shows NaN and Infinity as themselves, where JSON would say null', () => {
        expect(got(Number.NaN)).toContain('(got NaN)')
        expect(got(Number.POSITIVE_INFINITY)).toContain('(got Infinity)')
        expect(got(null)).toContain('(got null)')
    })

    it('survives a bigint, which JSON cannot serialize', () => {
        expect(got(5n)).toContain('(got 5n)')
    })
})
