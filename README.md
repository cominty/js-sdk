# Cominty TypeScript SDK

[![npm version](https://img.shields.io/npm/v/@cominty-ai/sdk.svg)](https://www.npmjs.com/package/@cominty-ai/sdk)
[![CI](https://github.com/cominty/js-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/cominty/js-sdk/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/@cominty-ai/sdk.svg)](LICENSE)

Official TypeScript client for the Cominty managed agent chat API.

Start a conversation with an agent, stream its progress live, and manage threads
— with a small, fully-typed surface and **zero runtime dependencies**.

```ts
import { Cominty } from '@cominty-ai/sdk'

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

## Contents

- [Requirements](#requirements) · [Installation](#installation) · [Authentication](#authentication)
- [Quick start](#quick-start) · [Capabilities](#capabilities)
- [Message parameters](#message-parameters) · [Configuration](#configuration) · [Error handling](#error-handling)
- [Examples](#examples) · [Contributing](#contributing)

**Going deeper:**

| Guide | Covers |
| --- | --- |
| [API reference](docs/api.md) | Every method, parameter, type and export |
| [Streaming guide](docs/streaming.md) | Event reference, cancelling, resuming a dropped stream, relaying to a browser |
| [Error handling guide](docs/errors.md) | What throws where, rate limits, a retry policy |

---

## Requirements

- **Node 20+**, or any server-side runtime with global `fetch` and
  `ReadableStream` (Bun, Deno, edge workers)
- A Cominty API key and your user id — see [Authentication](#authentication)

The package is **ESM-only** and ships its own type declarations. From CommonJS,
`require('@cominty-ai/sdk')` works on Node 22.12+; on older versions use
`await import('@cominty-ai/sdk')`.

## Installation

```bash
npm install @cominty-ai/sdk
# or: pnpm add @cominty-ai/sdk · yarn add @cominty-ai/sdk · bun add @cominty-ai/sdk
```

## Authentication

You need two things, both from [platform.cominty.ai](https://platform.cominty.ai):

1. **API key** → [platform.cominty.ai/api-keys](https://platform.cominty.ai/api-keys)
   (shown once — copy it).
2. **Your user id** → avatar (top right) → **Profile**. It looks like
   `user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ`.

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
> backend — the streaming guide shows how to
> [relay progress to a browser](docs/streaming.md#forwarding-events-to-a-browser).
> `dangerouslyAllowBrowser: true` exists for trusted environments only.

On runtimes without `process.env`, such as edge workers, pass `apiToken` and
`userId` explicitly.

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

In TypeScript, call `isKnownEvent(event)` first to get a fully typed `event.data`
in each branch. The [streaming guide](docs/streaming.md) covers that, along with
the full event reference and cancellation.

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

### Cap the agent's tool rounds

`maxSteps` limits how many tool rounds — one call to the model plus the tools it
picks — the agent may run for **one message**. Reaching the cap is not an error:
the agent stops using tools, recaps, and asks whether to continue, and the
message ends with `status: 'success'`. Continue with a normal follow-up.

```ts
const run = await client.chat.start({
    agentId,
    message: 'Research X, then write it up.',
    maxSteps: 5,
})
await run.text()

// The cap is per message, not per thread: pass it again to keep it.
const reply = await client.chat.send(run.thread.id, {
    agentId,
    message: 'Yes, continue.',
    maxSteps: 10,
})
console.log(await reply.text())
```

Leave `maxSteps` out and the server default applies — 60 today, on every message
that does not carry its own. There is no "unlimited": `null`, `0` and anything
else that is not an integer `>= 1` throw `InvalidParams`.

> Nothing flags that the cap was reached — no field, no event, no error code —
> and the reply's wording is the model's, so don't parse it. The cap is also an
> order of magnitude rather than an exact count, and it limits rounds, not
> tokens, cost or time.

To let an agent essentially never hit the cap, pass a very large value such as
`maxSteps: 999`. Do it with care: your budget is checked once, when the agent
starts, and the cost is deducted only when it finishes — so a long run on an
expensive model can go well past the budget you meant before anything stops it.

### Stop a message

`chat.cancel(messageId)` stops an assistant message that is still being
generated and returns it with `status` set to `'cancelled'`. It takes effect
immediately, and what the agent produced so far stays in `events`.

```ts
const run = await client.chat.start({ agentId, message: 'Write a very long report.' })

for await (const event of run) {
    if (userClickedStop()) {
        const message = await client.chat.cancel(run.messageId)
        console.log(message.status) // 'cancelled'
        break // closes the event stream
    }
}
```

Cancelling is not idempotent: a message that already finished, failed, or was
already cancelled throws `APIError` (status 400, `"Message is not live"`), so a
"stop" button should treat that error as "too late". An unknown message throws
`NotFoundError`. Aborting a `signal` is different: it only closes your
connection, and the agent keeps running.

### Export a message as a document

`chat.export(messageId, { format })` renders a finished message to a file and
returns its bytes as a `Uint8Array`. `format` is `'pdf'` or `'docx'` (any other
value throws `InvalidParams` before a request is sent).

```ts
import { writeFile } from 'node:fs/promises'

const run = await client.chat.start({ agentId, message: 'Write a short product brief.' })
const reply = await run.result()

const pdf = await client.chat.export(reply.id, { format: 'pdf' })
await writeFile('brief.pdf', pdf)
```

The server sends no file name, so pick one when you write the bytes. A message
without content (for instance one still running) throws `APIError` (status 400,
`"Message has no content"`).

### Give the agent files

`chat.uploadFile` registers a file, and its `id` goes in `fileIds` (5 files per
message at most). Pass a `Blob` or a `File` (a `File`'s name and type are used),
or an `ArrayBuffer` or `Uint8Array` (then `filename` is required). `filename` and
`mimetype` can always be overridden; a mimetype left out is the `Blob`'s type,
then a guess from the file name, then `application/octet-stream`.

```ts
import { openAsBlob } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

const report = await client.chat.uploadFile(await openAsBlob('q3-report.pdf'), {
    filename: 'q3-report.pdf',
})
const data = await client.chat.uploadFile(new TextEncoder().encode('a,b\n1,2\n'), {
    filename: 'data.csv',
})

const run = await client.chat.start({
    agentId,
    message: 'Compare these two files.',
    fileIds: [report.id, data.id],
})
const reply = await run.result()

// Download any conversation file by id, including the ones the agent produced.
// Keep only the last path segment: file names are not under your control.
for (const file of reply.files) {
    await writeFile(basename(file.name), await client.chat.downloadFile(file.id))
}
```

A string is refused (`InvalidParams`): it would be ambiguous between a path and
text. The bytes go straight to the storage backend through a presigned URL: your
API key is only ever sent to the Cominty API, and error messages never show a
presigned URL's signature. A file is at most 500 MiB: a bigger one throws
`InvalidParams` before anything is sent. The server also caps the number of
uploads per day per organization, and another deployment may set a lower size
limit; such a refusal throws `APIError` with the storage reason (for instance
`EntityTooLarge`). The API has no way to delete or list uploaded files, and a
download is held in memory.

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

### Memory files

`client.memory` stores files an agent can read back later. Each file lives in a
**namespace** — a name you choose — and is identified by its namespace and its
path. Nothing creates a namespace: the first file you put in one does.

```ts
const namespace = 'support-bot'

// `namespace` is required on every call but `list` and `listNamespaces`.
let file = await client.memory.create({
    path: 'tone.md',
    namespace,
    purpose: 'writing style',   // why the file exists — the agent reads it
    content: 'Keep it casual.',
})

// Summaries, without `content`. Leave `namespace` out to list every file the
// API key can see.
for (const f of await client.memory.list({ namespace })) {
    console.log(f.path, f.purpose, f.version)
}
await client.memory.listNamespaces()                 // names holding at least one file

file = await client.memory.get('tone.md', { namespace })

// Partial update: only what you pass changes. `version` is the one from your
// last read — a stale one throws ConflictError (409).
file = await client.memory.update('tone.md', {
    namespace,
    version: file.version,
    content: 'Keep it upbeat.',
})

await client.memory.delete('tone.md', { namespace })
```

To let an agent use the files, start the thread in their namespace with the
`memory` [capability](#capabilities):

```ts
const run = await client.chat.start({
    agentId,
    message: 'Use the tone file.',
    threadCapabilities: { memory: { activation: 'always', namespace } },
})
```

Three things to know before you rely on it:

- **The namespace is fixed when the thread starts.** The thread keeps it for
  life, and `chat.send` takes no `threadCapabilities` — passing them throws
  `InvalidParams`. Start a new thread to use another one.
- **A thread with no namespace may have no memory.** Without a `memory`
  capability, a thread uses the namespace set on its agent, if there is one;
  otherwise it runs with no memory tools at all, and no error, field or event
  says so. `{ activation: 'never' }` runs it without memory whatever the agent
  has.
- **A namespace is shared by the whole organization.** The client's `userId` is
  not part of it, and memory calls do not send it. To keep your end users apart,
  put an identifier in the name — `support-bot-${userId}` — and don't treat a
  namespace as a secret between agents: any agent started with the name can read
  and write it.

If you relied on the older per-user platform memory, it is still there under the
namespace `${userId}::default` — `client.memory.listNamespaces()` shows them.

And a few smaller ones: `namespace` is at most 128 characters and is never
trimmed; `path` is at most one folder deep (`preferences/tone.md`, not
`a/b/tone.md`); `content` may be empty; `version` is an opaque token to pass back
unchanged; `update` cannot clear a field, so `null` throws `InvalidParams`; and
`delete` is not idempotent — a path already gone throws `NotFoundError`. The
[API reference](docs/api.md#clientmemory) has every method.

### Reattach to a run in flight

`chat.stream(messageId)` opens a stream without starting anything — useful for
picking a run back up, or resuming one whose connection dropped.

```ts
const run = client.chat.stream(messageId, { lastEventId })
for await (const event of run) console.log(event.name)
```

See [Resuming a dropped stream](docs/streaming.md#resuming-a-dropped-stream) for
a complete reconnect loop.

## Capabilities

A capability is something the agent may use: `web`, `indexedDocuments`, `mcp`,
`skills`, `imageGeneration`, `videoGeneration`, `musicGeneration`, plus `memory`.
Each one is an explicit object, and the parameter name tells you the scope:

```ts
import { ALL } from '@cominty-ai/sdk'

const run = await client.chat.start({
    agentId,
    message: 'Summarize every board deck',
    threadCapabilities: {
        // frozen for the thread, start only
        web: { activation: 'always' },
        // documentIds left out: defaults to ALL
        indexedDocuments: { activation: 'always', sourceIds: [101] },
        // explicit ALL, same as leaving connections out
        mcp: { activation: 'on_request', connections: ALL },
        skills: { activation: 'always' },
        imageGeneration: { activation: 'on_request' },
        memory: { activation: 'always', namespace: 'support-bot' },
    },
    // this message only
    messageScope: { imageGeneration: { enabled: true } },
})

await client.chat.send(run.thread.id, {
    agentId,
    message: 'Only deck 2024',
    messageScope: {
        indexedDocuments: { enabled: true, sourceIds: [101] },
        mcp: { enabled: true, connections: ['linear'] },
        web: { enabled: false },
    },
})
```

- There are no shortcuts: no `web: true`, no `web: 'on_request'`. Thread
  capabilities are `{ activation }` objects, message scopes are `{ enabled }`
  objects, and the activation is always required.
- Activation is `'always'` (on by default), `'on_request'` (off until a message
  enables it) or `'never'` (not installed). `skills` and `memory` have no
  `'on_request'`. A capability you do not pass keeps the agent's value.
- Filters (`sourceIds`, `documentIds`, `connections`, `include`) default to `ALL`
  (the string `'*'`, no restriction), so passing `ALL` only makes the intent
  explicit. A capability you send replaces the stored one, so a filter left out
  resets to `ALL`. Otherwise pass a non-empty array: `null`, `[]` and a `'*'`
  inside an array throw `InvalidParams`.
- `'never'` and `enabled: false` send nothing else: passing a filter with them
  throws `InvalidParams`.
- `memory: { activation: 'always', namespace }` attaches the thread to a memory
  bag, `memory: { activation: 'never' }` runs it without memory. A message has
  no memory scope. The bag is frozen for the thread: a follow-up cannot change
  it.
- `messageScope` has no `skills` or `memory`, and `chat.send` takes no
  `threadCapabilities` (the API would answer 422).
- A message can only narrow what the thread allows. The server answers 422
  (`APIError`) when it widens an allowlist or targets a capability the thread
  does not have.

`sourceIds`, `documentIds`, `disabledTools` and `memoryNamespace` still work but
are deprecated: use `messageScope` and `threadCapabilities.memory` instead. They
cannot be mixed: `messageScope` with any of the first three, or `memoryNamespace`
with `threadCapabilities.memory`, throws `InvalidParams`.

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
| [`07-max-steps.ts`](examples/07-max-steps.ts) | Cap tool rounds for one message, then continue past the cap |
| [`08-memory-files.ts`](examples/08-memory-files.ts) | Create, list, update and delete memory files; start a thread in their namespace |

```bash
git clone https://github.com/cominty/js-sdk.git && cd js-sdk
export COMINTY_API_KEY=... COMINTY_USER_ID=user_...
node examples/01-stream-events.ts   # Node 24+ runs TypeScript directly
```

They call the real API and spend real credits. On an older Node, run them with
`npx tsx` — see [`examples/README.md`](examples/README.md).

## Message parameters

Both `chat.start` and `chat.send` accept:

| Argument | Type | Notes |
| --- | --- | --- |
| `agentId` | `string` | **Required.** The agent to run. |
| `message` | `string` | **Required.** The user's message (max 30,000 chars). |
| `name` | `string` | `start` only — names the new thread. |
| `fileIds` | `string[]` | Ids of files uploaded with `chat.uploadFile()` (max 5). |
| `threadCapabilities` | `AgentCapabilities` | `start` only — capability override, frozen for the thread. Includes the memory bag (`memory`). Sent as `options.capabilities`. |
| `messageScope` | `MessageScope` | Turn capabilities on/off or narrow them for this message. Sent as `message.scope`. |
| `sourceIds` | `number[]` | **Deprecated** — use `messageScope.indexedDocuments.sourceIds`. |
| `documentIds` | `string[]` | **Deprecated** — use `messageScope.indexedDocuments.documentIds`. |
| `disabledTools` | `DisablableTool[]` | **Deprecated** — turn tools off with `messageScope`. |
| `memoryNamespace` | `string` | `start` only. **Deprecated** — use `threadCapabilities.memory`. |
| `maxSteps` | `number` | Cap on tool rounds for **this message** (integer `>= 1`). Per message, not per thread; left out, the server default applies (60 today). |
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
} from '@cominty-ai/sdk'

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

The SDK never retries on its own, because re-sending a message would start a
second run. The [error handling guide](docs/errors.md) has the full reference and
a retry policy you can copy.

## Costs are strings

`cost.total`, `cost.input_cost` and `cost.output_cost` arrive as decimal
**strings** and stay strings. Parsing them to `number` loses precision when you
sum many of them; use a decimal library if you need to add them up.

## Versioning

The SDK follows [semantic versioning](https://semver.org). While it is `0.x`, a
minor release may include breaking changes; every one is listed in the
[changelog](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
pnpm install
pnpm test     # fetch is fully mocked — no network, no credits
pnpm check    # type-check
pnpm build    # compile to dist/
```

Found a security problem? Please report it privately, as described in
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
