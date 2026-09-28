# Error handling guide

- [The hierarchy](#the-hierarchy)
- [What throws where](#what-throws-where)
- [API errors](#api-errors)
- [Rate limits](#rate-limits)
- [Connection errors and timeouts](#connection-errors-and-timeouts)
- [Invalid parameters](#invalid-parameters)
- [Retrying](#retrying)

## The hierarchy

Every error the SDK raises while talking to the API is a `ComintyError`:

```
ComintyError
├── APIError              the API responded with 4xx/5xx
│   ├── AuthError         401
│   ├── PermissionError   403
│   ├── NotFoundError     404
│   ├── ConflictError     409
│   ├── RateLimitError    429
│   └── ServerError       5xx
├── APIConnectionError    no response arrived: network failure or timeout
├── StreamInterrupted     the server shut down mid-stream
├── InvalidParams         arguments rejected before any request was sent
└── SDKError              unexpected state, or a run consumed twice
```

All are exported from `@cominty/sdk`, and `error.name` is the class name. Catch
the specific classes you can act on and let the rest propagate:

```ts
import { APIError, ComintyError, RateLimitError } from '@cominty/sdk'

try {
    const run = await client.chat.start({ agentId, message: 'hi' })
    console.log(await run.text())
} catch (error) {
    if (error instanceof RateLimitError) {
        console.log(`rate limited (${error.scope})`)
    } else if (error instanceof APIError) {
        console.log(`API error ${error.status}: ${error.message}`)
    } else if (error instanceof ComintyError) {
        console.log(`SDK error: ${error.message}`)
    } else {
        throw error
    }
}
```

Two kinds of error are deliberately **not** `ComintyError`:

- **Configuration errors.** `new Cominty()` throws a plain `Error` when the API
  key or user id is missing or malformed, or when it is constructed in a browser.
  These are programming mistakes to fix, not conditions to handle at runtime.
- **Your own cancellation.** Aborting through an `AbortSignal` you passed
  surfaces as the standard `AbortError`.

## What throws where

| Call | Can throw |
| --- | --- |
| `new Cominty()` | `Error` (configuration) |
| `chat.start`, `chat.send` | `InvalidParams`, `APIError`, `APIConnectionError` |
| `chat.stream` | Nothing — it makes no request until the run is consumed |
| Iterating a run, `run.result()`, `run.text()`, `run.questions()` | `APIError`, `APIConnectionError`, `StreamInterrupted`, `SDKError` |
| `threads.*` | `APIError`, `APIConnectionError` |

Note that a run can fail **while streaming**, after `chat.start` has already
succeeded. Wrap the code that consumes the run, not just the call that creates
it.

A run that finishes with `message.status === 'failed'` does not throw: the
request worked, the agent did not. Check `status` on the result of
`run.result()` when you need to tell the difference.

## API errors

`APIError` and its subclasses carry the response:

| Property | Description |
| --- | --- |
| `status` | HTTP status code |
| `message` | The API's error message when it sent one, otherwise `HTTP <status>` |
| `detail` | The response's `detail` field: a string, an object, an array, or `null` |
| `body` | The full decoded response body |
| `headers` | The response `Headers` |

| Class | Status | Usual cause |
| --- | --- | --- |
| `AuthError` | 401 | Missing, mistyped or revoked API key |
| `PermissionError` | 403 | The key is valid but may not access this resource |
| `NotFoundError` | 404 | Wrong thread, message or agent id |
| `ConflictError` | 409 | The request conflicts with the resource's current state |
| `RateLimitError` | 429 | See [Rate limits](#rate-limits) |
| `ServerError` | 5xx | A problem on Cominty's side; usually worth retrying |
| `APIError` | other 4xx | Anything without a dedicated class |

## Rate limits

A 429 means one of three different things, and `error.scope` says which:

| `scope` | Meaning | What to do |
| --- | --- | --- |
| `'concurrency'` | Too many chat sessions running at once | Transient. Retry when an in-flight run finishes. |
| `'user'` | This user's request quota is used up | Wait for the reset, or have an admin raise the limit. |
| `'organization'` | The organization's quota is used up | Wait for the reset, or have an admin raise the limit. |
| `null` | The response did not say | Treat as transient. |

`RateLimitError` also exposes:

| Property | Type | Description |
| --- | --- | --- |
| `retryAfter` | `number \| null` | Seconds to wait, when the API sent a `Retry-After` header |
| `resetAt` | `Date \| null` | When the quota resets, when the API said |

`error.message` already explains which limit was hit and what to do about it, so
it is suitable for logs as-is.

## Connection errors and timeouts

`APIConnectionError` means no HTTP response arrived: DNS failure, refused
connection, dropped socket, or a timeout. The underlying error is on
`error.cause`.

Ordinary requests time out after 60 seconds by default. Change it per client, in
milliseconds:

```ts
const client = new Cominty({ timeout: 10_000 })
```

Streams are exempt from this timeout, since a run can take minutes. To bound one,
pass an `AbortSignal` — see [Cancelling](streaming.md#cancelling). When a stream
drops partway, you can [resume it](streaming.md#resuming-a-dropped-stream) rather
than start over.

## Invalid parameters

`chat.start` and `chat.send` validate their arguments before sending anything.
`InvalidParams` lists every problem at once, not just the first:

```ts
import { InvalidParams } from '@cominty/sdk'

try {
    await client.chat.start({ agentId: '', message: 'hi', fileIds: ['a', 'b', 'c', 'd', 'e', 'f'] })
} catch (error) {
    if (error instanceof InvalidParams) {
        for (const problem of error.errors) {
            console.log(problem.param, '—', problem.message)
        }
        // agentId — required, must be a non-empty string
        // fileIds — must contain at most 5 items, got 6
    }
}
```

Each entry has `param`, `message` and, where useful, the offending `input`.

## Retrying

The SDK does **not** retry on its own. Sending a message is not idempotent —
retrying a `chat.start` that actually reached the server would start a second
run and bill you twice — so the decision is left to you.

A reasonable policy:

| Error | Retry? |
| --- | --- |
| `RateLimitError` with scope `'concurrency'` or `null` | Yes, after a delay |
| `RateLimitError` with scope `'user'` or `'organization'` | Not until `resetAt` |
| `ServerError` | Yes, with backoff |
| `APIConnectionError` on a read (`threads.list`, `threads.get`) | Yes |
| `APIConnectionError` on `chat.start` / `chat.send` | Carefully — the message may have been accepted |
| `APIConnectionError` while streaming | [Resume the stream](streaming.md#resuming-a-dropped-stream) instead |
| `AuthError`, `PermissionError`, `NotFoundError`, `InvalidParams` | No — fix the request |

```ts
import { RateLimitError, ServerError } from '@cominty/sdk'

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await fn()
        } catch (error) {
            const quotaExhausted =
                error instanceof RateLimitError &&
                (error.scope === 'user' || error.scope === 'organization')
            const retryable =
                (error instanceof RateLimitError && !quotaExhausted) ||
                error instanceof ServerError

            if (!retryable || attempt >= maxAttempts) throw error

            const seconds =
                error instanceof RateLimitError && error.retryAfter !== null
                    ? error.retryAfter
                    : 2 ** attempt
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        }
    }
}

const threads = await withRetry(() => client.threads.list())
```
