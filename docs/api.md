# API reference

Everything exported from `@cominty-ai/sdk`. Every type on this page is importable by
name:

```ts
import { Cominty, type Message, type MessageParams } from '@cominty-ai/sdk'
```

- [`Cominty`](#cominty)
- [`client.chat`](#clientchat) — [`start`](#chatstartparams) · [`send`](#chatsendthreadid-params) · [`stream`](#chatstreammessageid-options)
- [`AssistantRun`](#assistantrun)
- [`client.threads`](#clientthreads) — [`list`](#threadslistparams) · [`get`](#threadsgetthreadid-options) · [`update`](#threadsupdatethreadid-params) · [`archive`](#threadsarchivethreadid-options)
- [`client.memory`](#clientmemory) — [`list`](#memorylistparams) · [`listNamespaces`](#memorylistnamespacesoptions) · [`create`](#memorycreateparams) · [`get`](#memorygetpath-options) · [`update`](#memoryupdatepath-params) · [`delete`](#memorydeletepath-options)
- [Data types](#data-types) — [`Message`](#message) · [`Thread`](#thread-and-threadsummary) · [`Question`](#question) · [`ConversationFile`](#conversationfile) · [`MemoryFile`](#memoryfile-and-memoryfilesummary)
- [Events](#events)
- [Errors](#errors)
- [Helpers and constants](#helpers-and-constants)

Response objects use the API's `snake_case` field names (`thread_id`,
`created_at`). Arguments you pass use `camelCase` (`agentId`, `fileIds`).

---

## `Cominty`

```ts
new Cominty(options?: ComintyOptions)
```

Create one client and reuse it. It holds no persistent connection.

### `ComintyOptions`

| Option | Type | Environment variable | Default |
| --- | --- | --- | --- |
| `apiToken` | `string` | `COMINTY_API_KEY` | — (required) |
| `userId` | `string` | `COMINTY_USER_ID` | — (required) |
| `baseUrl` | `string` | `COMINTY_BASE_URL` | `https://ds.cominty.com` |
| `timeout` | `number` | — | `60000` — milliseconds; streams are exempt |
| `fetch` | `typeof fetch` | — | The global `fetch` |
| `dangerouslyAllowBrowser` | `boolean` | — | `false` |

Each option resolves as **explicit argument → environment variable → default**.

Throws a plain `Error` if `apiToken` or `userId` is missing, if `userId` is
malformed, or if constructed in a browser without `dangerouslyAllowBrowser`.

### Members

| Member | Type | Description |
| --- | --- | --- |
| `chat` | `ChatResource` | Start and continue conversations |
| `threads` | `ThreadsResource` | List and manage threads |
| `memory` | `MemoryResource` | Read and write memory files |
| `userId` | `string` | The user every request acts on behalf of |
| `baseUrl` | `string` | The resolved API base URL |
| `close()` | `void` | Abort every in-flight request and stream |

The client is disposable, so `await using client = new Cominty()` calls
`close()` when it goes out of scope.

---

## `client.chat`

### `chat.start(params)`

```ts
start(params: StartChatParams): Promise<StartedChat>
```

Start a new thread with a first message. Resolves as soon as the agent has
started, with a [run](#assistantrun) whose `thread` is always set.

```ts
const run = await client.chat.start({ agentId, message: 'What is Cominty?' })
console.log(run.thread.id, await run.text())
```

### `chat.send(threadId, params)`

```ts
send(threadId: string, params: MessageParams): Promise<AssistantRun>
```

Send a follow-up message in an existing thread. Also how you answer an agent's
[questions](#question). The returned run's `thread` is `undefined` — you already
hold the thread id.

### Message parameters

`MessageParams`, accepted by both methods:

| Parameter | Type | Description |
| --- | --- | --- |
| `agentId` | `string` | **Required.** The agent to run. |
| `message` | `string` | **Required.** The user's message. At most 30,000 characters. |
| `fileIds` | `string[]` | Previously uploaded files to attach. At most 5. |
| `sourceIds` | `number[]` | Restrict retrieval to these knowledge sources. |
| `documentIds` | `string[]` | Restrict retrieval to these documents. |
| `disabledTools` | `DisablableTool[]` | Tools to turn off for this message. |
| `maxSteps` | `number` | Cap on tool rounds for this message. An integer `>= 1`. See [Capping tool rounds](#capping-tool-rounds). |
| `signal` | `AbortSignal` | Cancels the request and the run's stream. |

`StartChatParams` adds:

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | A name for the new thread. |
| `memoryNamespace` | `string` | The thread's memory namespace. At most 128 characters. See [Memory namespace](#memory-namespace). |

`DisablableTool` is `'web'`, `'company_documents'`, `'mcp:<server>'` for one MCP
server, or `'mcp:*'` for all of them.

Invalid arguments throw [`InvalidParams`](errors.md#invalid-parameters) before
any request is sent.

### Capping tool rounds

`maxSteps` caps the agent's tool rounds for **one message**. A round is one call
to the model plus the tools it picks, so one round can hold several tool calls.

- **Per message, not per thread.** A follow-up without `maxSteps` runs with the
  server default again, whatever the previous message used. Pass it on every
  call to keep a cap.
- **Left out, the server default applies** — 60 today, and it may change. There
  is no "unlimited" and no upper bound: `null`, `0`, a negative number, a
  fraction, `NaN`, `Infinity`, a boolean or a string throws `InvalidParams`.
- **Reaching the cap is not an error.** The agent stops using tools, writes a
  short recap and asks whether to continue; the message ends with
  `status: 'success'`. No field, event or error code says the cap was reached,
  and the wording is the model's, so do not parse it. Continue with `chat.send`.
- **It is an order of magnitude, not an exact count.** It is checked after each
  round, so the agent can run `maxSteps + 1` of them, and each sub-agent has its
  own budget. It limits rounds, not tokens, cost or time.
- **A very large value is not free.** `maxSteps: 999` lets the agent essentially
  never hit the cap, but the organization's budget is checked once, when the
  agent starts, and the cost is deducted only when it finishes. A long run on an
  expensive model can go well past the budget you meant before anything stops
  it.
- The value is not stored and not returned. Keep it yourself if you need it.

### Memory namespace

`memoryNamespace` gives a thread the [memory files](#clientmemory) of one
namespace to read and write.

- **Fixed when the thread starts.** The thread keeps it for life. `chat.send`
  does not take it, and passing it there throws `InvalidParams` rather than
  being dropped. Start a new thread to use another namespace.
- **Left out, the thread may have no memory.** It uses the namespace set on the
  agent, if there is one. Otherwise it runs with no memory tools at all, and no
  error, field or event says so. A value you pass wins over the agent's; you
  cannot force "no memory" on an agent that has a namespace.
- **Shared by the whole organization.** The client's `userId` is not part of
  it. To keep end users apart, put an identifier in the name, such as
  `support-bot-${userId}`. It is not a security boundary between agents either:
  any agent started with the name can read and write it.
- **The older per-user platform memory is a namespace too:**
  `${userId}::default`. Pass it to keep reading and writing those files;
  [`memory.listNamespaces`](#memorylistnamespacesoptions) shows them.
- At most 128 characters, never trimmed. Threads and messages do not echo it
  back, so keep the value you passed.

### `chat.stream(messageId, options?)`

```ts
stream(messageId: string, options?: { lastEventId?: string; signal?: AbortSignal }): AssistantRun
```

Attach to an assistant message by id. Synchronous: no request is made until the
run is consumed. Pass `lastEventId` to receive only the events after it. See
[Resuming a dropped stream](streaming.md#resuming-a-dropped-stream).

---

## `AssistantRun`

A handle to an assistant reply in progress. Iterate it for
[events](#events), or await its result. `StartedChat` is the same class with a
non-optional `thread`.

| Member | Type | Description |
| --- | --- | --- |
| `messageId` | `string` | Id of the assistant message |
| `thread` | `Thread \| undefined` | The thread, when the run came from `chat.start` |
| `lastEventId` | `string \| undefined` | Id of the last event received |
| `[Symbol.asyncIterator]()` | `AsyncIterator<AnyEvent>` | Yields progress events: `for await (const event of run)` |
| `result()` | `Promise<Message>` | The final message, draining the stream if needed |
| `text()` | `Promise<string>` | Shorthand for `(await run.result()).content` |
| `questions()` | `Promise<Question[]>` | The agent's clarifying questions; empty if it gave a final answer |
| `close()` | `Promise<void>` | Stop consuming and release the connection |

A run is single-use — see
[Consuming a run](streaming.md#consuming-a-run) for the exact rules.

---

## `client.threads`

All methods are scoped to the client's `userId`.

### `threads.list(params?)`

```ts
list(params?: ListThreadsParams): Promise<ThreadSummary[]>
```

The user's threads, newest first, without their messages.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | `number` | `50` | Page size. At most 100. |
| `page` | `number` | `0` | Zero-based page index. |
| `terms` | `string[]` | — | Free-text search terms. |
| `signal` | `AbortSignal` | — | Cancels the request. |

To read everything, request pages until one comes back shorter than `limit`:

```ts
async function* allThreads(limit = 100) {
    for (let page = 0; ; page++) {
        const batch = await client.threads.list({ limit, page })
        yield* batch
        if (batch.length < limit) return
    }
}
```

### `threads.get(threadId, options?)`

```ts
get(threadId: string, options?: { signal?: AbortSignal }): Promise<Thread>
```

One thread with its full message history.

### `threads.update(threadId, params)`

```ts
update(threadId: string, params: UpdateThreadParams): Promise<ThreadSummary>
```

Rename and/or star a thread. Only the fields you pass change.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | New name |
| `starred` | `boolean` | Star or unstar |
| `signal` | `AbortSignal` | Cancels the request |

### `threads.archive(threadId, options?)`

```ts
archive(threadId: string, options?: { signal?: AbortSignal }): Promise<void>
```

Archive a thread. This is a soft delete.

---

## `client.memory`

Files an agent can read back later. A file is identified by its **namespace** —
a name you choose — and its path, so the same path in two namespaces is two
files. There is no call to create or delete a namespace: its first file creates
it, and deleting its last file removes it.

Memory belongs to the namespace, not to a user: these calls do not send the
client's `userId`, and a namespace is shared by the whole organization. See
[Memory namespace](#memory-namespace) for attaching one to a thread.

Checked before any request, with [`InvalidParams`](errors.md#invalid-parameters):

- `namespace` is a string of at most 128 characters. It is never trimmed, and an
  empty one is sent as given. It is required everywhere but `list`.
- `path` is at most one folder deep: `tone.md` and `preferences/tone.md` are
  fine, `a/b/tone.md` is not.

The limits on `purpose` (1 to 100 characters once trimmed) and `content` (1 MiB)
are the API's, and come back as an `APIError`.

### `memory.list(params?)`

```ts
list(params?: ListMemoryFilesParams): Promise<MemoryFileSummary[]>
```

File summaries — no `content` — most recently updated first.

| Parameter | Type | Description |
| --- | --- | --- |
| `namespace` | `string` | Keep one namespace. Left out, every file the API key can see. |
| `signal` | `AbortSignal` | Cancels the request. |

Without `namespace`, the same path can appear once per namespace, so key a file
by both.

### `memory.listNamespaces(options?)`

```ts
listNamespaces(options?: { signal?: AbortSignal }): Promise<string[]>
```

The names that hold at least one file, in no particular order.

### `memory.create(params)`

```ts
create(params: CreateMemoryFileParams): Promise<MemoryFile>
```

Create a file. Throws `ConflictError` if the path already exists in the
namespace.

| Parameter | Type | Description |
| --- | --- | --- |
| `path` | `string` | **Required.** At most one folder deep. |
| `namespace` | `string` | **Required.** The namespace the file goes in. |
| `purpose` | `string` | **Required.** Why the file exists. The agent reads it. |
| `content` | `string` | **Required.** The file's body. May be empty. |
| `signal` | `AbortSignal` | Cancels the request. |

### `memory.get(path, options)`

```ts
get(path: string, options: { namespace: string; signal?: AbortSignal }): Promise<MemoryFile>
```

One file, with its content. Throws `NotFoundError` if the path is not in the
namespace.

### `memory.update(path, params)`

```ts
update(path: string, params: UpdateMemoryFileParams): Promise<MemoryFile>
```

Change a file's content and/or purpose. Only the fields you pass change, and at
least one is required.

| Parameter | Type | Description |
| --- | --- | --- |
| `namespace` | `string` | **Required.** The namespace the file is in. |
| `version` | `string` | **Required.** The `version` from your last read of the file, unchanged. |
| `content` | `string` | New body. |
| `purpose` | `string` | New purpose. |
| `signal` | `AbortSignal` | Cancels the request. |

`version` is an opaque token: never parse or compare it. A stale one throws
`ConflictError` — read the file again and retry with the version it returns. A
malformed one is not caught locally; the API answers 422, an `APIError`.

A field cannot be cleared. The API would ignore a `null` and still answer 200,
so `content: null` or `purpose: null` throws `InvalidParams` instead.

```ts
const file = await client.memory.get('tone.md', { namespace })
const updated = await client.memory.update('tone.md', {
    namespace,
    version: file.version,
    content: 'Keep it upbeat.',
})
// The next write must use updated.version.
```

### `memory.delete(path, options)`

```ts
delete(path: string, options: { namespace: string; signal?: AbortSignal }): Promise<void>
```

Delete a file. Not idempotent: a path that is already gone throws
`NotFoundError`.

---

## Data types

Response types are open-ended: the API may return fields that are not listed
here, and they are preserved on the object.

### `Message`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | |
| `thread_id` | `string` | |
| `role` | `'user' \| 'assistant'` | |
| `content` | `string` | The message text |
| `status` | `'pending' \| 'running' \| 'success' \| 'failed' \| 'cancelled'` | |
| `live` | `boolean` | Whether the message is still being produced |
| `questions` | `Question[] \| null` | Clarifying questions, if the agent asked any |
| `files` | `ConversationFile[]` | Files attached to or produced by the message |
| `structured_output` | `Record<string, unknown> \| null` | Structured output, for agents that produce it |
| `events` | `Record<string, unknown>[] \| null` | The raw stored event log — not the typed stream events |

### `Thread` and `ThreadSummary`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | |
| `name` | `string` | |
| `created_at` | `string` | ISO-8601 timestamp |
| `live` | `boolean` | Whether a run is in progress |
| `agent` | `{ id: string; name: string }` | The thread's agent |
| `starred` | `boolean` | |
| `project_id` | `string \| null \| undefined` | |
| `messages` | `Message[]` | **`Thread` only** |

### `Question`

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string` | What the agent is asking |
| `options` | `string[]` | Suggested answers |

Answer by sending one of the options, or any free text, with `chat.send`.

### `ConversationFile`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | |
| `name` | `string` | |
| `size` | `number` | Bytes |
| `mimetype` | `string` | |
| `origin` | `'user' \| 'agent'` | Who supplied the file |
| `url` | `string` | |
| `share_links` | `ShareLink[]` | |

`ShareLink` has `id`, `url`, `created_at`, `expires_at`, `last_accessed_at`,
`access_count`, `revoked`, `expired` and `protected`.

### `MemoryFile` and `MemoryFileSummary`

| Field | Type | Description |
| --- | --- | --- |
| `path` | `string` | |
| `namespace` | `string` | The namespace the file is in, as you named it |
| `purpose` | `string` | Why the file exists |
| `content` | `string` | The file's body — **`MemoryFile` only** |
| `created_at` | `string` | ISO-8601 timestamp |
| `updated_at` | `string` | ISO-8601 timestamp |
| `version` | `string` | Opaque token to pass back to `memory.update` |

Supporting types: `ListMemoryFilesParams`, `CreateMemoryFileParams`,
`UpdateMemoryFileParams`.

---

## Events

Described in full in the
[streaming guide](streaming.md#event-reference).

| Type | `name` |
| --- | --- |
| `WaitingForStartEvent` | `'waiting_for_start'` |
| `SettingUpSandboxEvent` | `'setting_up_sandbox'` |
| `UploadingFileEvent` | `'uploading_file'` |
| `LlmEvent` | `'llm'` |
| `ToolCallEvent` | `'tool_call'` |
| `IntermediaryUpdateEvent` | `'intermediary_update'` |
| `ResultEvent` | `'result'` |
| `UnknownEvent` | Any name this SDK version does not model |

`KnownEvent` is the union of the first seven; `AnyEvent` is
`KnownEvent | UnknownEvent`. Supporting types: `EventStatus`, `Cost`,
`AgentFile`.

---

## Errors

Described in full in the [error handling guide](errors.md).

| Class | Raised when | Extra properties |
| --- | --- | --- |
| `ComintyError` | Base class | |
| `APIError` | The API responded with 4xx/5xx | `status`, `detail`, `body`, `headers` |
| `AuthError` | 401 | |
| `PermissionError` | 403 | |
| `NotFoundError` | 404 | |
| `ConflictError` | 409 | |
| `RateLimitError` | 429 | `scope`, `retryAfter`, `resetAt` |
| `ServerError` | 5xx | |
| `APIConnectionError` | No response arrived | `cause` |
| `StreamInterrupted` | The server shut down mid-stream | `partial` |
| `InvalidParams` | Arguments failed validation | `errors` |
| `SDKError` | Unexpected state, or a run consumed twice | |

Supporting types: `ErrorDetail`, `InvalidParam`, `RateLimitScope`.

---

## Helpers and constants

| Export | Description |
| --- | --- |
| `isKnownEvent(event)` | Type guard: narrows `AnyEvent` to `KnownEvent` |
| `isTerminalStatus(status)` | `true` for `'success'`, `'failed'` and `'error'` |
| `isFailureStatus(status)` | `true` for `'failed'` and `'error'` |
| `validateUserId(value)` | Returns `value`, or throws if it is not a well-formed user id |
| `DEFAULT_BASE_URL` | `'https://ds.cominty.com'` |
| `DEFAULT_TIMEOUT_MS` | `60000` |
| `CONTENT_MAX_LENGTH` | `30000` — maximum `message` length |
| `MAX_FILES` | `5` — maximum `fileIds` per message |
| `DISABLE_ALL_MCP` | `'mcp:*'` |
| `DISABLE_MCP_PREFIX` | `'mcp:'` |
