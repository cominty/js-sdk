# Streaming guide

How runs, events and the final message fit together — and how to cancel, resume
and recover.

- [The model](#the-model)
- [Consuming a run](#consuming-a-run)
- [Event reference](#event-reference)
- [Handling events you don't know about](#handling-events-you-dont-know-about)
- [Cancelling](#cancelling)
- [Resuming a dropped stream](#resuming-a-dropped-stream)
- [Server interruptions](#server-interruptions)
- [Forwarding events to a browser](#forwarding-events-to-a-browser)

## The model

`chat.start` and `chat.send` each make one `POST` that starts the agent and
returns immediately with a **run** — a handle to the assistant's reply, which is
still being produced. Nothing is streamed until you consume the run.

A run's stream carries two kinds of things:

1. **Progress events** — what the agent is doing: queueing, LLM calls, tool
   calls, progress notes, and the `result`.
2. **The final message** — a complete [`Message`](api.md#message) that ends the
   stream.

Iterating a run yields the events. The final message is captured for you and
returned by `run.result()`.

> **This is progress streaming, not token streaming.** There is no text-delta
> event. The reply arrives whole in the `result` event (`event.data.reply`) and
> again in the final message (`message.content`).

## Consuming a run

**Await the answer** when you don't need progress:

```ts
const run = await client.chat.start({ agentId, message: 'Summarize our Q3 report.' })
const text = await run.text()
```

**Iterate** when you do. The final message is available once the loop ends:

```ts
const run = await client.chat.start({ agentId, message: 'Summarize our Q3 report.' })

for await (const event of run) {
    console.log(event.name, event.status)
}

const message = await run.result() // cached — no second request
```

A run is **single-use**. Iterate it once, or await its result once:

| You did | Then `run.result()` / `run.text()` |
| --- | --- |
| Nothing yet | Drains the stream and returns the final message |
| Iterated to the end | Returns the cached final message |
| Broke out of the loop early | Throws `SDKError` — the final message was never received |
| Iterate a second time | Throws `SDKError` on the first pull |

If you stopped early and still want the message, fetch the thread with
`client.threads.get(threadId)`, or reattach with
[`client.chat.stream`](#resuming-a-dropped-stream).

## Event reference

Every event has these fields:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Event id. Pass it as `lastEventId` to resume after this event. |
| `name` | `string` | The event type — the discriminant. |
| `status` | `'running' \| 'success' \| 'failed' \| 'error'` | Where the step is in its lifecycle. |
| `correlation_id` | `number` | Groups the events of one logical step. |
| `at` | `string` | ISO-8601 timestamp. |

A step typically emits one event with `status: 'running'` and a second with a
final status, both sharing a `correlation_id`. Use `isTerminalStatus(status)` and
`isFailureStatus(status)` rather than comparing strings.

| `name` | When | `data` |
| --- | --- | --- |
| `waiting_for_start` | The run is queued, waiting for a worker | — |
| `setting_up_sandbox` | The execution sandbox is being provisioned | — |
| `uploading_file` | A file is being uploaded | `filename` |
| `llm` | An LLM call | `description`, `model`, `error?` |
| `tool_call` | A tool call | `name`, `description`, `message?` (on success), `error?` (on failure) |
| `intermediary_update` | A human-readable progress note from the agent | `message` |
| `result` | The agent's answer | `reply`, `files`, `questions?`, `metadata?`, `cost` |

Two things about `result`:

- It is **not the end of the stream.** More events can follow it. The stream ends
  when the final message arrives, which is when your `for await` loop exits.
- `data.cost` holds money amounts (`total`, `input_cost`, `output_cost`) as
  decimal **strings**. Keep them as strings, or use a decimal library; converting
  to `number` loses precision when you add them up.

## Handling events you don't know about

The server can add new event types at any time. Rather than throwing, the SDK
passes them through as `UnknownEvent`, so an old SDK version keeps working.

Call `isKnownEvent` first. Besides skipping unfamiliar events, it is what lets
TypeScript narrow `event.data` in each branch:

```ts
import { isKnownEvent } from '@cominty-ai/sdk'

for await (const event of run) {
    if (!isKnownEvent(event)) continue

    switch (event.name) {
        case 'tool_call':
            console.log(event.data.name, event.status) // data is typed
            break
        case 'result':
            console.log(event.data.reply)
            break
    }
}
```

## Cancelling

Pass an `AbortSignal`. It covers both the initial request and the stream:

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 30_000)

try {
    const run = await client.chat.start({ agentId, message, signal: controller.signal })
    console.log(await run.text())
} catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
        console.log('cancelled')
    } else {
        throw error
    }
}
```

Your own abort surfaces as the standard `AbortError`, not as a `ComintyError`, so
it is easy to tell apart from a real failure.

To stop reading without an error, `break` out of the loop or call
`await run.close()`. `client.close()` aborts everything the client has in flight.

> Cancelling stops **your connection**. It does not stop the agent, which keeps
> running on the server; the finished message will be in the thread.

The client's `timeout` option applies to ordinary requests only. Streams have no
overall timeout, because a run can legitimately take minutes — use a signal to
bound one.

## Resuming a dropped stream

If the connection drops mid-run, the stream throws `APIConnectionError`. The run
is still in progress on the server, and you can pick it up where you left off:
`run.lastEventId` is the id of the last event you received, and
`client.chat.stream` opens a new stream from that point.

```ts
import { APIConnectionError, type AnyEvent, type Message } from '@cominty-ai/sdk'

async function streamWithResume(
    messageId: string,
    onEvent: (event: AnyEvent) => void,
    maxAttempts = 5,
): Promise<Message> {
    let lastEventId: string | undefined

    for (let attempt = 1; ; attempt++) {
        const run = client.chat.stream(messageId, { lastEventId })
        try {
            for await (const event of run) onEvent(event)
            return await run.result()
        } catch (error) {
            if (!(error instanceof APIConnectionError) || attempt >= maxAttempts) throw error
            lastEventId = run.lastEventId ?? lastEventId
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
    }
}

const started = await client.chat.start({ agentId, message })
const message = await streamWithResume(started.messageId, (event) => console.log(event.name))
```

`client.chat.stream` makes no request until the run is consumed, so it is also
how you attach to a run from another process: store `run.messageId`, and open
the stream wherever you need it.

## Server interruptions

If the server shuts down while a run is streaming, the stream throws
`StreamInterrupted`. Its `partial` property is the message as far as it got:

```ts
import { StreamInterrupted } from '@cominty-ai/sdk'

try {
    console.log(await run.text())
} catch (error) {
    if (error instanceof StreamInterrupted) {
        console.log('interrupted:', error.partial.status, error.partial.content)
    } else {
        throw error
    }
}
```

## Forwarding events to a browser

The SDK is server-side only, because it holds your API key. To show live
progress in a web app, consume the run on your server and relay the events — for
example as server-sent events:

```ts
// Any runtime with web-standard Request/Response: Next.js, Hono, Bun, Deno…
export async function POST(request: Request): Promise<Response> {
    const { message } = await request.json()
    const run = await client.chat.start({ agentId, message, signal: request.signal })

    const encoder = new TextEncoder()
    const send = (event: string, data: unknown) =>
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                for await (const event of run) controller.enqueue(send('progress', event))
                controller.enqueue(send('done', await run.result()))
            } catch (error) {
                controller.enqueue(send('error', { message: (error as Error).message }))
            } finally {
                controller.close()
            }
        },
        cancel: () => run.close(),
    })

    return new Response(body, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
}
```

Relay only what your UI needs. Events can include tool names, model names and
cost, which you may not want to expose to end users.
