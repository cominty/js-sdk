/**
 * Exception hierarchy for the Cominty SDK.
 *
 * ```
 * ComintyError
 * ├── APIError              HTTP 4xx/5xx
 * │   ├── AuthError         401
 * │   ├── PermissionError   403
 * │   ├── NotFoundError     404
 * │   ├── ConflictError     409
 * │   ├── RateLimitError    429
 * │   └── ServerError       5xx
 * ├── APIConnectionError    network / timeout — no response arrived
 * ├── StreamInterrupted     the server shut down mid-stream
 * ├── InvalidParams         arguments rejected before any request was sent
 * └── SDKError              a bug inside the SDK
 * ```
 *
 * The wire error body is FastAPI's `{ detail: string | object | array }`, parsed
 * onto `APIError.detail` with the full body kept on `.body`.
 */

import type { Message } from './models/chat.ts'

/** Base class for every error raised by the SDK. */
export class ComintyError extends Error {
    constructor(message: string) {
        super(message)
        this.name = new.target.name
    }
}

export type ErrorDetail = string | Record<string, unknown> | unknown[] | null

export interface APIErrorInit {
    status: number
    detail?: ErrorDetail
    body?: unknown
    headers?: Headers
}

/** An HTTP error response (4xx/5xx) from the Cominty API. */
export class APIError extends ComintyError {
    /** The HTTP status code. */
    readonly status: number
    /** The parsed `detail` field: a string, an object, or a list (422). */
    readonly detail: ErrorDetail
    /** The full raw decoded response body, if any. */
    readonly body: unknown
    readonly headers: Headers | undefined

    constructor(message: string, init: APIErrorInit) {
        super(message)
        this.status = init.status
        this.detail = init.detail ?? null
        this.body = init.body
        this.headers = init.headers
    }
}

/** 401 — missing or invalid `x-cominty-token`. */
export class AuthError extends APIError {}
/** 403 — authenticated, but not allowed. */
export class PermissionError extends APIError {}
/** 404 — the resource does not exist. */
export class NotFoundError extends APIError {}
/** 409 — the request conflicts with the current state. */
export class ConflictError extends APIError {}
/** 5xx — the server failed to handle the request. */
export class ServerError extends APIError {}

/** Which limit a 429 hit. */
export type RateLimitScope = 'organization' | 'user' | 'concurrency'

/**
 * 429 — a rate limit was hit, in one of three ways (see {@link scope}):
 *
 * - `concurrency` — too many chat sessions at once. Transient: retry once an
 *   in-flight request finishes.
 * - `organization` / `user` — that quota is exhausted; an org admin must raise
 *   the plan limit.
 */
export class RateLimitError extends APIError {
    /** Which limit was hit, or `null` if undeterminable. */
    get scope(): RateLimitScope | null {
        const detail = this.detail
        if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
            const quota = (detail as Record<string, unknown>).quota_reached
            if (typeof quota === 'string' && quota) return quota as RateLimitScope
        }
        if (typeof detail === 'string' && detail.toLowerCase().includes('concurrent')) {
            return 'concurrency'
        }
        return null
    }

    /** Seconds to wait before retrying, from the `Retry-After` header if sent. */
    get retryAfter(): number | null {
        const raw = this.headers?.get('retry-after')
        if (raw === null || raw === undefined) return null
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : null
    }

    /** When the quota clears, from the `reset_at` detail field or the header. */
    get resetAt(): Date | null {
        const detail = this.detail
        if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
            const d = detail as Record<string, unknown>
            const parsed = parseDate(d.reset_at ?? d.locked_until)
            if (parsed) return parsed
        }
        return parseDate(this.headers?.get('x-ratelimit-reset'))
    }
}

/** The request never produced an HTTP response (network error or timeout). */
export class APIConnectionError extends ComintyError {
    readonly cause: unknown
    constructor(message: string, cause?: unknown) {
        super(message)
        this.cause = cause
    }
}

/**
 * The server shut down mid-stream before the message completed.
 *
 * `partial` is the message as far as it got — its `status` reflects how much was
 * persisted.
 */
export class StreamInterrupted extends ComintyError {
    readonly partial: Message
    constructor(message: string, partial: Message) {
        super(message)
        this.partial = partial
    }
}

/** One offending argument in an {@link InvalidParams} error. */
export interface InvalidParam {
    /** The public argument that failed, e.g. `disabledTools[0]`. */
    param: string
    /** Why it failed. */
    message: string
    /** The bad value (`undefined` for missing params). */
    input?: unknown
}

/**
 * Arguments failed validation before any request was sent.
 *
 * Raised at the call boundary so a typo costs a millisecond instead of a
 * round-trip and a 400.
 */
export class InvalidParams extends ComintyError {
    readonly errors: InvalidParam[]
    constructor(context: string, errors: InvalidParam[]) {
        const lines = errors.map((e) => {
            const got =
                'input' in e && e.input !== undefined ? ` (got ${JSON.stringify(e.input)})` : ''
            return `  - ${e.param}: ${e.message}${got}`
        })
        super(`Invalid parameters for ${context}:\n${lines.join('\n')}`)
        this.errors = errors
    }
}

/** A bug inside the SDK. Should never reach users. */
export class SDKError extends ComintyError {}

// --------------------------------------------------------------------------- //

const STATUS_MAP: Record<number, new (message: string, init: APIErrorInit) => APIError> = {
    401: AuthError,
    403: PermissionError,
    404: NotFoundError,
    409: ConflictError,
    429: RateLimitError,
}

/** Build the right {@link APIError} subclass from a failed HTTP response. */
export function errorFromResponse(status: number, body: unknown, headers?: Headers): APIError {
    let detail: ErrorDetail = null
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        detail = ((body as Record<string, unknown>).detail ?? null) as ErrorDetail
    }

    const Cls = STATUS_MAP[status] ?? (status >= 500 ? ServerError : APIError)
    // A bare "HTTP 429" is useless — say which limit was hit and what to do.
    const message =
        Cls === RateLimitError
            ? rateLimitMessage(detail, headers)
            : typeof detail === 'string' && detail
              ? detail
              : `HTTP ${status}`

    return new Cls(message, { status, detail, body, headers })
}

const ADMIN_HINT = "Ask an organization admin to raise your plan's limit."

const QUOTA_HEAD: Record<string, string> = {
    organization:
        "Organization rate limit reached: your organization's total request quota is exhausted",
    user: 'User rate limit reached: your user request quota is exhausted',
}

function rateLimitMessage(detail: ErrorDetail, headers?: Headers): string {
    const info =
        detail && typeof detail === 'object' && !Array.isArray(detail)
            ? (detail as Record<string, unknown>)
            : {}
    const text = typeof detail === 'string' ? detail.trim() : ''
    const quota = info.quota_reached

    let head: string
    if (typeof quota === 'string' && quota in QUOTA_HEAD) {
        head = QUOTA_HEAD[quota]!
    } else if (typeof quota === 'string' && quota) {
        // Forward-compat: a scope name this SDK version does not know yet.
        head = `${quota[0]!.toUpperCase()}${quota.slice(1)} rate limit reached: request quota exhausted`
    } else if (text.toLowerCase().includes('concurrent')) {
        // The concurrency cap is transient — the count frees as requests finish —
        // but raising it still needs an admin.
        return (
            "Too many concurrent requests: your plan's limit on simultaneous chat sessions is " +
            `reached. Wait for an in-flight request to finish and retry, or raise the limit. ${ADMIN_HINT}`
        )
    } else {
        head = text || 'Rate limit reached'
    }

    const when = whenPhrase(parseDate(info.reset_at ?? info.locked_until), headers)
    return `${head}. ${ADMIN_HINT}${when ? ` ${when}` : ''}`
}

function whenPhrase(resetAt: Date | null, headers?: Headers): string {
    const raw = headers?.get('retry-after')
    if (raw !== null && raw !== undefined) {
        const seconds = Number(raw)
        if (Number.isFinite(seconds)) return `You can retry in ${seconds}s.`
    }
    if (resetAt) return `Quota resets at ${resetAt.toISOString()}.`
    return ''
}

function parseDate(raw: unknown): Date | null {
    if (typeof raw !== 'string') return null
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}
