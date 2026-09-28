# Cominty TypeScript SDK

Official TypeScript client for the Cominty managed agent chat API.

Start a conversation with an agent, stream its progress live, and manage threads
— with a small, fully-typed surface and **zero runtime dependencies**.

```ts
import { Cominty } from '@cominty/sdk'

const client = new Cominty() // reads COMINTY_API_KEY + COMINTY_USER_ID
const run = await client.chat.start({
    agentId: '__cominty_agents::agent.chat',
    message: 'What is Cominty?',
})
console.log(await run.text())
```

- **Zero dependencies** — native `fetch`, `ReadableStream`, `AbortController`.
- **Fully typed** — events are a discriminated union you narrow with `event.name`.
- **One handle for streaming *and* awaiting** — iterate a run for live progress
  events, or just `await run.text()` for the final answer.
- **Fail-fast validation** — bad arguments throw locally, before any request.
- **Typed errors** — every failure is a `ComintyError` subclass.

This is a port of the [Python SDK](https://github.com/cominty/python-sdk); the two
track the same API and the same release cadence.

---

## Requirements

- **Node 20+** (or any runtime with global `fetch` and `ReadableStream`)
- A Cominty API key and your user id — see [Authentication](#authentication)

## Installation

```bash
npm install @cominty/sdk
# or: pnpm add @cominty/sdk · yarn add @cominty/sdk · bun add @cominty/sdk
```

## Authentication

You need two things, both from [platform.cominty.ai](https://platform.cominty.ai):

1. **API key** → [platform.cominty.ai/api-keys](https://platform.cominty.ai/api-keys)
   (shown once — copy it).
2. **Your user id** → avatar (top right) → **Profile**. It looks like
   `user_31HPTBuBvX20xlQNAbvxjOxPbKB`.

The user id identifies the end user every request acts on behalf of. It is set
**once on the client** (or via `COMINTY_USER_ID`) and applied to every call, so
resource methods never take it.

```bash
export COMINTY_API_KEY="<your API key>"
export COMINTY_USER_ID="user_..."
```

```ts
const client = new Cominty() // picks both up from the environment
```

…or pass them explicitly (explicit arguments win over the environment):

```ts
const client = new Cominty({ apiToken: '<your API key>', userId: 'user_...' })
```

A malformed `userId` is rejected at construction, not as a server error later.

> **Server-side only.** Constructing a client in a browser throws: your API key
> would be readable by anyone who opens devtools. Call the API from your own
> backend. `dangerouslyAllowBrowser: true` exists for trusted environments only.

### Picking an agent

Every chat call takes an `agentId`. Browse your agents and copy an id at
[platform.cominty.ai/agents](https://platform.cominty.ai/agents) — they look like
`__cominty_agents::agent.chat`.

## Quick start

Every conversation starts with `chat.start`, which returns a **run** — a handle to
the assistant's in-progress reply. From there, pick the style you need.

### Just get the answer

```ts
const run = await client.chat.start({ agentId, message: 'Give me one fun fact.' })
console.log(await run.text()) // waits until the agent finishes
```

`await run.result()` gives the full message (status, files, structured output,
questions). `text()` is shorthand for `result().content`.

### Stream progress events

Iterating a run yields **progress events only** — tool calls, LLM steps, the
result event — as they happen. The finished reply is captured for you.

```ts
const run = await client.chat.start({ agentId, message: 'Research X and summarize.' })

for await (const event of run) {
    if (event.name === 'tool_call') {
        console.log(`tool ${event.data.name} -> ${event.status}`)
    } else if (event.name === 'llm') {
        console.log(`llm  ${event.data.description}`)
    } else if (event.name === 'result') {
        console.log(`cost ${event.data.cost.total}`)
    }
}

console.log('FINAL:', await run.text()) // available after the stream drains
```

> This is **progress streaming, not token streaming** — there is no text-delta
> event. The reply arrives whole, once, in the `result` event and again in the
> terminal message.

> A run's stream is single-use: iterate it **or** await its result. The result is
> cached, so calling `text()` after iterating is free.

### Continue the conversation

`chat.send(threadId, …)` is the mirror of `start` for an existing thread: same
arguments, same streamable run. The agent keeps the thread's context.

```ts
const first = await client.chat.start({ agentId, message: 'Pick a language.' })
await first.text()

const second = await client.chat.send(first.thread.id, {
    agentId,
    message: 'Now show hello-world in it.',
})
console.log(await second.text())
```

### Answer the agent's questions

When an agent needs more input, it ends its turn with clarifying **questions** (a
`prompt` plus suggested `options`) instead of a final answer. Read them, then
answer with a normal follow-up:

```ts
const run = await client.chat.start({ agentId, message: 'Book me a room.' })
await run.text()

for (const q of await run.questions()) {
    console.log(q.prompt, q.options)
}

const reply = await client.chat.send(run.thread.id, { agentId, message: 'Tomorrow 10am' })
console.log(await reply.text())
```

### Manage threads

`client.threads` is scoped to the client's `userId` automatically.

```ts
for (const t of await client.threads.list({ limit: 20 })) {
    console.log(t.created_at, t.name, t.id)
}

await client.threads.list({ terms: ['invoice'] })   // free-text search
await client.threads.list({ limit: 10, page: 1 })   // paginate (zero-based)

const thread = await client.threads.get(threadId)   // full message history
await client.threads.update(threadId, { name: 'Renamed', starred: true })
await client.threads.archive(threadId)              // soft-delete
```

### Reattach to a run in flight

`chat.stream(messageId)` opens a stream without starting anything — useful for
picking a run back up, or resuming one whose connection dropped.

```ts
const run = client.chat.stream(messageId, { lastEventId })
for await (const event of run) console.log(event.name)
```

## Examples

Runnable scripts live in [`examples/`](examples/):

| Script | Shows |
| --- | --- |
| [`01-stream-events.ts`](examples/01-stream-events.ts) | Stream progress events live |
| [`02-await-result.ts`](examples/02-await-result.ts) | Fire and await the final answer |
| [`03-follow-up.ts`](examples/03-follow-up.ts) | Continue in the same thread |
| [`04-answer-questions.ts`](examples/04-answer-questions.ts) | Read and answer agent questions |
| [`05-list-threads.ts`](examples/05-list-threads.ts) | List and search threads |
| [`06-manage-thread.ts`](examples/06-manage-thread.ts) | Get, rename/star, archive |

```bash
export COMINTY_API_KEY=... COMINTY_USER_ID=user_...
node --experimental-strip-types examples/01-stream-events.ts
```

## Message parameters

Both `chat.start` and `chat.send` accept:

| Argument | Type | Notes |
| --- | --- | --- |
| `agentId` | `string` | **Required.** The agent to run. |
| `message` | `string` | **Required.** The user's message (max 30,000 chars). |
| `name` | `string` | `start` only — names the new thread. |
| `fileIds` | `string[]` | Attach previously-uploaded files (max 5). |
| `sourceIds` | `number[]` | Restrict retrieval to specific knowledge sources. |
| `documentIds` | `string[]` | Restrict retrieval to specific documents. |
| `disabledTools` | `DisablableTool[]` | Turn tools off: `'web'`, `'company_documents'`, `'mcp:<server>'`, or `'mcp:*'`. |
| `signal` | `AbortSignal` | Cancel the request. |

Invalid values throw `InvalidParams` **before** any request is sent, naming every
offending argument at once.

## Configuration

| Option | Env var | Default |
| --- | --- | --- |
| `apiToken` | `COMINTY_API_KEY` | — (required) |
| `userId` | `COMINTY_USER_ID` | — (required) |
| `baseUrl` | `COMINTY_BASE_URL` | `https://ds.cominty.com` |
| `timeout` | — | `60000` (**milliseconds**; streams are exempt) |
| `fetch` | — | global `fetch` |
| `dangerouslyAllowBrowser` | — | `false` |

Resolution order: **explicit argument → environment variable → default**. The SDK
does not read `.env` files; export the vars or load the file yourself.

`client.close()` aborts anything still in flight. It is optional — there is no
persistent connection — but `await using` will do it for you:

```ts
await using client = new Cominty()
```

## Error handling

Every error is a subclass of `ComintyError`:

```ts
import {
    ComintyError,        // base — catch-all
    APIError,            // any 4xx/5xx; carries .status, .detail and .body
    AuthError,           // 401
    PermissionError,     // 403
    NotFoundError,       // 404
    ConflictError,       // 409
    RateLimitError,      // 429 — exposes .scope, .retryAfter and .resetAt
    ServerError,         // 5xx
    APIConnectionError,  // network failure / timeout, no response
    StreamInterrupted,   // server shut down mid-stream — carries the .partial message
    InvalidParams,       // client-side validation failed — .errors lists each problem
    SDKError,            // unexpected SDK-internal condition
} from '@cominty/sdk'

try {
    const run = await client.chat.start({ agentId, message: 'hi' })
    console.log(await run.text())
} catch (error) {
    if (error instanceof RateLimitError) {
        console.log(`slow down (${error.scope}) — retry after ${error.resetAt}`)
    } else if (error instanceof APIError) {
        console.log(`API error ${error.status}: ${error.detail}`)
    } else {
        throw error
    }
}
```

A 429 is not always the same problem — `error.scope` tells you which:
`'concurrency'` is transient (retry once an in-flight run finishes), while
`'organization'` and `'user'` mean a quota is exhausted and an admin must raise
the plan limit.

## Costs are strings

`cost.total`, `cost.input_cost` and `cost.output_cost` arrive as decimal
**strings** and stay strings. Parsing them to `number` loses precision when you
sum many of them; use a decimal library if you need to add them up.

## Development

```bash
pnpm --filter @cominty/sdk test     # vitest, fetch fully mocked — no network
pnpm --filter @cominty/sdk build    # tsc -> dist (ESM + .d.ts)
pnpm --filter @cominty/sdk check    # tsc --noEmit
```

## License

MIT
