# API reference

Everything exported from `@cominty-ai/sdk`. Every type on this page is importable by
name:

```ts
import { Cominty, type Message, type MessageParams } from '@cominty-ai/sdk'
```

- [`Cominty`](#cominty)
- [`client.chat`](#clientchat) — [`start`](#chatstartparams) · [`send`](#chatsendthreadid-params) · [`stream`](#chatstreammessageid-options) · [`cancel`](#chatcancelmessageid-options) · [`export`](#chatexportmessageid-params) · [`uploadFile`](#chatuploadfilefile-params) · [`downloadFile`](#chatdownloadfilefileid-options)
- [Capabilities and message scope](#capabilities-and-message-scope) — [`AgentCapabilities`](#agentcapabilities) · [`MessageScope`](#messagescope)
- [`AssistantRun`](#assistantrun)
- [`client.threads`](#clientthreads) — [`list`](#threadslistparams) · [`get`](#threadsgetthreadid-options) · [`update`](#threadsupdatethreadid-params) · [`archive`](#threadsarchivethreadid-options)
- [`client.memory`](#clientmemory) — [`list`](#memorylistparams) · [`listNamespaces`](#memorylistnamespacesoptions) · [`create`](#memorycreateparams) · [`get`](#memorygetpath-options) · [`update`](#memoryupdatepath-params) · [`delete`](#memorydeletepath-options)
- [`client.sources`](#clientsources) — [`create`](#sourcescreatefiles-params) · [`list`](#sourceslistoptions) · [`get`](#sourcesgetsourcepid-options) · [`update`](#sourcesupdatesourcepid-params) · [`addFiles`](#sourcesaddfilessourcepid-files-options) · [`listFiles`](#sourceslistfilessourcepid-options) · [`removeFile`](#sourcesremovefilesourcepid-fileid-options) · [`downloadFile`](#sourcesdownloadfilefileid-options) · [status operations](#status-operations) · [`waitSynced`](#sourceswaitsyncedsourcepid-params)
- [`client.agents`](#clientagents) — [`list`](#agentslistoptions) · [`listModels`](#agentslistmodelsoptions) · [`get`](#agentsgetagentid-options) · [`create`](#agentscreateparams) · [`update`](#agentsupdateagentid-params) · [`setModels`](#agentssetmodelsagentid-params) · [`delete`](#agentsdeleteagentid-options)
- [`client.skills`](#clientskills) — [`list`](#skillslistoptions) · [`create`](#skillscreatefile-params) · [`update`](#skillsupdateskillid-params) · [`uploadVersion`](#skillsuploadversionskillid-file-options) · [`delete`](#skillsdeleteskillid-options)
- [`client.documents`](#clientdocuments) · [`client.mcp`](#clientmcp)
- [Data types](#data-types) — [`Message`](#message) · [`Thread`](#thread-and-threadsummary) · [`Question`](#question) · [`ConversationFile`](#conversationfile) · [`MemoryFile`](#memoryfile-and-memoryfilesummary) · [`Source`](#source-and-sourcefile) · [`AgentDetail`](#agentdetail-and-agentsummary) · [`Skill`](#skill) · [`DocumentMetadata`](#documentmetadata) · [`McpServer`](#mcpserver)
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
| `sources` | `SourcesResource` | Index files as a document source |
| `agents` | `AgentsResource` | List agents, manage custom ones |
| `skills` | `SkillsResource` | Upload the skills an agent can load |
| `documents` | `DocumentsResource` | Resolve a cited document |
| `mcp` | `McpResource` | List the MCP integrations a key can use |
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
| `fileIds` | `string[]` | Ids from [`chat.uploadFile`](#chatuploadfilefile-params) to attach. At most 5. |
| `messageScope` | [`MessageScope`](#messagescope) | Turn capabilities on or off, or narrow them, for this message only. Sent as `message.scope`. |
| `sourceIds` | `number[]` | **Deprecated:** use `messageScope.indexedDocuments.sourceIds`. Restrict retrieval to these knowledge sources. |
| `documentIds` | `string[]` | **Deprecated:** use `messageScope.indexedDocuments.documentIds`. Restrict retrieval to these documents. |
| `disabledTools` | `DisablableTool[]` | **Deprecated:** turn tools off with `messageScope`. Tools to turn off for this message. |
| `maxSteps` | `number` | Cap on tool rounds for this message. An integer `>= 1`. See [Capping tool rounds](#capping-tool-rounds). |
| `signal` | `AbortSignal` | Cancels the request and the run's stream. |

`StartChatParams` adds:

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | A name for the new thread. |
| `threadCapabilities` | [`AgentCapabilities`](#agentcapabilities) | Overrides some of the agent's capabilities for this thread, frozen for its life. Sent as `options.capabilities`. |
| `memoryNamespace` | `string` | **Deprecated:** use `threadCapabilities.memory`. The thread's memory namespace. At most 128 characters. See [Memory namespace](#memory-namespace). |

`DisablableTool` (deprecated with `disabledTools`) is `'web'`,
`'company_documents'`, `'mcp:<server>'` for one MCP server, or `'mcp:*'` for all
of them.

Invalid arguments throw [`InvalidParams`](errors.md#invalid-parameters) before
any request is sent. So do these combinations, which the API would refuse or
which name the same thing twice:

- `threadCapabilities` on `chat.send` (the API answers 422: a follow-up cannot
  change the thread's capabilities);
- `messageScope` with any of `sourceIds`, `documentIds` or `disabledTools` (the
  API answers 422: send only `messageScope`);
- `memoryNamespace` with `threadCapabilities.memory` (both name the thread's
  memory).

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

`threadCapabilities: { memory: { activation: 'always', namespace } }` gives a
thread the [memory files](#clientmemory) of one namespace to read and write. The
deprecated `memoryNamespace` does the same.

- **Fixed when the thread starts.** The thread keeps it for life. `chat.send`
  takes neither, and passing them there throws `InvalidParams` rather than
  being dropped. Start a new thread to use another namespace.
- **Left out, the thread may have no memory.** It uses the namespace set on the
  agent, if there is one. Otherwise it runs with no memory tools at all, and no
  error, field or event says so. A value you pass wins over the agent's, and
  `memory: { activation: 'never' }` runs the thread without memory whatever the
  agent has.
- **Shared by the whole organization.** The client's `userId` is not part of
  it. To keep end users apart, put an identifier in the name, such as
  `support-bot-${userId}`. It is not a security boundary between agents either:
  any agent started with the name can read and write it.
- **The older per-user platform memory is a namespace too:**
  `${userId}::default`. Pass it to keep reading and writing those files;
  [`memory.listNamespaces`](#memorylistnamespacesoptions) shows them.
- At most 128 characters, never trimmed. Threads and messages do not echo it
  back, so keep the value you passed. In `threadCapabilities.memory` it must
  not be empty; the deprecated `memoryNamespace` sends an empty one as given.

### `chat.stream(messageId, options?)`

```ts
stream(messageId: string, options?: { lastEventId?: string; signal?: AbortSignal }): AssistantRun
```

Attach to an assistant message by id. Synchronous: no request is made until the
run is consumed. Pass `lastEventId` to receive only the events after it. See
[Resuming a dropped stream](streaming.md#resuming-a-dropped-stream).

### `chat.cancel(messageId, options?)`

```ts
cancel(messageId: string, options?: { signal?: AbortSignal }): Promise<Message>
```

Stop an assistant message that is still being generated (`POST
/chat/messages/{messageId}/cancel`). Resolves with the message, its `status` set
to `'cancelled'`; what the agent produced so far stays in `events`.

- `messageId` must be a UUID, or `InvalidParams` is thrown before any request.
- **Not idempotent.** A message that already finished, failed or was cancelled
  throws `APIError` with status 400 (`"Message is not live"`). User messages are
  never live. An unknown message throws `NotFoundError`.
- Unlike aborting a `signal`, which only closes your connection, this stops the
  agent on the server.

### `chat.export(messageId, params)`

```ts
export(messageId: string, params: ExportMessageParams): Promise<Uint8Array>
```

Render a finished message's content (Markdown) as a document and return its
bytes (`GET /chat/messages/{messageId}/export?format=…`). No file name comes
back: pick one when you write the bytes.

| Parameter | Type | Description |
| --- | --- | --- |
| `format` | `ExportFormat` | **Required.** `'pdf'` or `'docx'`. |
| `signal` | `AbortSignal` | Cancels the request. |

A bad `messageId` or `format` throws `InvalidParams` before any request. A
message with no content, for instance one still running, throws `APIError` with
status 400 (`"Message has no content"`).

### `chat.uploadFile(file, params?)`

```ts
uploadFile(file: UploadSource, params?: UploadFileParams): Promise<ConversationFile>
```

Upload a file so a message can use it: pass the returned `id` in `fileIds`. It
runs the whole presigned upload — `GET /chat/files/upload` for a permission, a
multipart `POST` of the bytes straight to the storage backend, then `POST
/chat/files` to confirm — and resolves with the registered
[`ConversationFile`](#conversationfile).

`UploadSource` is a `Blob` (a `File` is one), an `ArrayBuffer`, or a view of one
such as a `Uint8Array` or a Node `Buffer`. In Node, upload a path with
`await fs.openAsBlob(path)`.

| Parameter | Type | Description |
| --- | --- | --- |
| `filename` | `string` | 1 to 255 characters, no `/`. Optional for a `File` with a name, required otherwise. |
| `mimetype` | `string` | Left out: the `Blob`'s `type`, then a guess from the file name, then `application/octet-stream`. |
| `signal` | `AbortSignal` | Cancels every request of the upload. |

- Checked before anything is sent, with `InvalidParams`: the kind of `file` (a
  string is refused, as ambiguous between a path and text), its size (at most
  500 MiB, `UPLOAD_MAX_BYTES`), `filename` and `mimetype`. The file is never
  echoed in an error.
- The storage request carries none of the client's headers, so your API key
  only ever goes to the Cominty API. Error messages leave out the presigned
  URL's query, where its signature is.
- A storage refusal throws the `APIError` for its status, with the storage
  reason as `detail` (for instance `EntityTooLarge: …`). So does a redirect,
  which a presigned URL cannot survive. The server also caps uploads per day per
  organization.
- An answer the SDK cannot use — a permission without a `url` or a `key`, or a
  storage success without an `ETag` header — throws `SDKError`. In a browser,
  the bucket's CORS rules must expose `ETag` to your origin.
- The client's `timeout` applies to each of the three requests.

### `chat.downloadFile(fileId, options?)`

```ts
downloadFile(fileId: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>
```

The content of a conversation file, uploaded or produced by the agent. `GET
/chat/files/{fileId}` answers with a presigned URL valid for 5 minutes; the bytes
are then fetched from it without your API key. Not scoped to the client's
`userId`: any file created through the API in the same organization can be
downloaded. The whole file is held in memory.

An empty `fileId` throws `InvalidParams`; an unknown one `NotFoundError`; an
answer that is not a URL `SDKError`; a storage refusal its `APIError`.

---

## Capabilities and message scope

A capability is something the agent may use. `threadCapabilities` on
`chat.start` installs or removes capabilities for the thread's whole life;
`messageScope` on `chat.start` and `chat.send` turns them on or off, or narrows
them, for one message. Both are plain objects with camelCase keys, sent in
snake_case. See the [README](../README.md#capabilities) for a full example.

### `AgentCapabilities`

| Key | Type | Activations | Filters |
| --- | --- | --- | --- |
| `web` | `SingleCapability` | `always`, `on_request`, `never` | — |
| `indexedDocuments` | `IndexedDocumentsCapability` | `always`, `on_request`, `never` | `sourceIds: number[]`, `documentIds: string[]` |
| `mcp` | `McpCapability` | `always`, `on_request`, `never` | `connections: string[]` |
| `skills` | `SkillsCapability` | `always`, `never` | `include: string[]` |
| `imageGeneration` | `SingleCapability` | `always`, `on_request`, `never` | — |
| `videoGeneration` | `SingleCapability` | `always`, `on_request`, `never` | — |
| `musicGeneration` | `SingleCapability` | `always`, `on_request`, `never` | — |
| `memory` | `MemoryCapability` | `always`, `never` | `namespace: string`, required with `always` |

Each entry is `{ activation, ...filters }`. `'always'` is on by default,
`'on_request'` is installed but off until a message enables it, `'never'` is not
installed. A capability you pass replaces the agent's; the others keep the
agent's value.

### `MessageScope`

`web`, `indexedDocuments`, `mcp`, `imageGeneration`, `videoGeneration` and
`musicGeneration`, each `{ enabled, ...filters }` with the same filters as above.
There is no `skills` or `memory` scope. A message can only narrow what the
thread allows: widening an allowlist, or targeting a capability the thread does
not have, is the server's 422.

### Rules

Checked before any request, every problem named in one `InvalidParams`:

- `activation` (or `enabled`, a boolean) is required. There are no shortcuts
  like `web: true`.
- A filter is `ALL` (`'*'`, every id the end user can access) or a non-empty
  array. Left out, it is `ALL`, and is sent as such. `null`, `[]` and a `'*'`
  inside an array are refused. `sourceIds` are integers, the other ids strings.
- `'never'` and `enabled: false` take no filter, and are sent as
  `{ activation: 'never' }` and `{ enabled: false }` alone.
- `memory` with `'always'` needs a `namespace` of 1 to 128 characters; with
  `'never'` it takes none.
- Unknown keys are refused, with a hint when a snake_case key has a camelCase
  name (`source_ids` → `sourceIds`).

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

## `client.sources`

Document sources an agent can search. `create` turns files into a private
drag-and-drop source in one call: it creates the drive behind it, uploads every
file with a presigned URL (the API key never reaches the storage backend), and
creates the source, whose first sync starts at once.

Every method takes the source's **`pid`**; capabilities
(`indexedDocuments.sourceIds`) take its numeric **`id`**. These calls do not send
the client's `userId`.

> **Known limitation.** Sources created with an API key are private to the admin
> who minted the key. Chats that search them must use that admin's Clerk id as the
> client's `userId`: it is `owner` on any agent the key created. With another
> `userId`, the agent's document tool reports no authorized source.

Files are a `SourceFileInput`: a `File` (its `name` is used), or a `NamedFile`
`{ filename, content, mimetype? }` whose `content` is a `Blob`, `ArrayBuffer` or
`Uint8Array`. Checked before any request, with
[`InvalidParams`](errors.md#invalid-parameters): at least one file, at most 50 in
the source (`SOURCE_MAX_FILES`), unique names of 1 to 255 characters without `/`.
A string is refused rather than read as a path; in Node, wrap a file's bytes in a
`File`.

### `sources.create(files, params?)`

```ts
create(files: SourceFileInput | readonly SourceFileInput[], params?: CreateSourceParams): Promise<Source>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name shown in the console. Left out, the server picks one. |
| `signal` | `AbortSignal` | Cancels the flow. |

Files are uploaded one after the other. If a step fails (for instance
`Too many drives`, or a storage refusal) the source is not created, and the drive
is left to the server's cleanup. The returned source is `pending` or `syncing`:
await [`waitSynced`](#sourceswaitsyncedsourcepid-params) before searching it.

### `sources.list(options?)`

```ts
list(options?: { signal?: AbortSignal }): Promise<Source[]>
```

The organization's sources plus the ones the key created, archived ones included.

### `sources.get(sourcePid, options?)`

```ts
get(sourcePid: string, options?: { signal?: AbortSignal }): Promise<Source>
```

The API has no single-source read for keys, so this lists and picks: it costs
the same as `list`. Throws `NotFoundError` if no visible source has the `pid`.

### `sources.update(sourcePid, params)`

```ts
update(sourcePid: string, params: { name: string; signal?: AbortSignal }): Promise<Source>
```

Rename a source. The name is the only field of a drag-and-drop source that can
change.

### `sources.addFiles(sourcePid, files, options?)`

```ts
addFiles(sourcePid: string, files: SourceFileInput | readonly SourceFileInput[], options?: { signal?: AbortSignal }): Promise<SourceFile[]>
```

Upload more files into the source, then request a sync when the source accepts
one (`synced`, `error`, `out_of_sync`, `daily_quota_reached`). While a sync is
running, the new files are left for it, or for the daily one, to pick up. The
50-file cap counts the files already there. Files uploaded before a failure stay
in the source. Returns the files just added, in upload order.

### `sources.listFiles(sourcePid, options?)`

```ts
listFiles(sourcePid: string, options?: { signal?: AbortSignal }): Promise<SourceFile[]>
```

The files the source is built from. A connected source (Google Drive,
SharePoint) has none, and throws `SDKError`.

### `sources.removeFile(sourcePid, fileId, options?)`

```ts
removeFile(sourcePid: string, fileId: string, options?: { signal?: AbortSignal }): Promise<void>
```

Delete a file (`DELETE /files/{fileId}`), then sync under the same rule as
`addFiles`.

### `sources.downloadFile(fileId, options?)`

```ts
downloadFile(fileId: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>
```

The file's bytes, fetched from a short-lived presigned URL without your API key.
The whole file is held in memory.

### Status operations

```ts
start(sourcePid: string, options?: { signal?: AbortSignal }): Promise<Source>
pause(sourcePid: string, options?: { signal?: AbortSignal }): Promise<Source>
sync(sourcePid: string, options?: { signal?: AbortSignal }): Promise<Source>
archive(sourcePid: string, options?: { signal?: AbortSignal }): Promise<Source>
```

Each sends `PUT /dc/sources/{pid}/status?operation=…`. An operation the current
status does not allow throws an `APIError` (400, `Operation is not valid`).

| Method | Does | Valid from |
| --- | --- | --- |
| `start` | Resumes a paused source | `paused` |
| `pause` | Stops syncing until `start`; a running sync is cancelled | Most statuses |
| `sync` | Syncs now instead of waiting for the daily sync | `synced`, `error`, `out_of_sync`, `daily_quota_reached` |
| `archive` | Terminal: removes the indexed documents, keeps the source listed | Anything but `archived` |

### `sources.waitSynced(sourcePid, params?)`

```ts
waitSynced(sourcePid: string, params?: WaitSyncedParams): Promise<Source>
```

Reads the source every `interval` while a sync is pending or running, and returns
it once `synced`.

| Parameter | Type | Description |
| --- | --- | --- |
| `timeout` | `number` | Milliseconds to wait at most. Default `600000` (10 minutes). |
| `interval` | `number` | Milliseconds between two reads. Default `5000`. |
| `signal` | `AbortSignal` | Aborts the wait. |

Throws `SourceSyncFailed` when the source stops anywhere other than `synced`
(`error`, `paused`, `archived`, `daily_quota_reached`, ...), and
`SourceSyncTimeout` once `timeout` has passed. Both carry the last source read as
`.source` (`null` on a timeout before any read finished). A timeout does not stop
the sync: wait again to keep following it.

---

## `client.agents`

The agents a key can use: the built-in Cominty agents (`managed: true`), the
organization's, and the ones owned by the key's creator. Custom agents can be
created, changed and deleted; built-in ones cannot, and throw `NotFoundError`.

An agent's `capabilities` come back camelCase, in the
[`AgentCapabilities`](#agentcapabilities) shape you pass, so a read can be sent
straight back through `update`. A capability this SDK version does not know, or a
newer shape of a known one, is left out of the read rather than failing it; the
API keeps it on update, since it merges capabilities key by key.

### `agents.list(options?)`

```ts
list(options?: { signal?: AbortSignal }): Promise<AgentSummary[]>
```

Summaries, without `instructions` or `models`.

### `agents.listModels(options?)`

```ts
listModels(options?: { signal?: AbortSignal }): Promise<LlmModel[]>
```

The language models an agent can run on: their ids go in `modelIds`.

### `agents.get(agentId, options?)`

```ts
get(agentId: string, options?: { signal?: AbortSignal }): Promise<AgentDetail>
```

### `agents.create(params)`

```ts
create(params: CreateAgentParams): Promise<AgentDetail>
```

The agent is owned by the admin who minted the API key (`owner`).

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | **Required.** Display name, not empty. |
| `description` | `string` | At most 500 characters. |
| `instructions` | `string` | System instructions, at most 30 000 characters. |
| `scope` | `Scope` | `'private'` (default, the owner only) or `'organization'`. |
| `capabilities` | `AgentCapabilities` | Left-out capabilities keep the platform defaults. `memory` sets the agent's namespace. |
| `allowExecutionOptionsOverride` | `boolean` | Let a chat override the agent's tools. Default `false`. |
| `modelIds` | `string[]` | Model chain in failover order. Left out, the organization's default. |
| `signal` | `AbortSignal` | Cancels the request. |

A `skills.include` naming a skill the key cannot read comes back as an
`APIError` (422).

### `agents.update(agentId, params)`

```ts
update(agentId: string, params: UpdateAgentParams): Promise<AgentDetail>
```

Partial: only the fields you pass are sent, and at least one is needed. Takes the
fields of `create` except `modelIds` (see `setModels`). `description`,
`instructions` and `capabilities` accept `null` to clear them; `null` on `name`,
`scope` or `allowExecutionOptionsOverride` throws `InvalidParams`. A
`capabilities` object is merged key by key: each capability you pass replaces the
stored one, the others stay.

### `agents.setModels(agentId, params)`

```ts
setModels(agentId: string, params: { modelIds: readonly string[]; signal?: AbortSignal }): Promise<AgentDetail>
```

Replace the model chain: at least one id, in failover order. On a built-in agent,
this sets the organization's chain for that agent's tier instead. An unknown
model id throws `NotFoundError`.

### `agents.delete(agentId, options?)`

```ts
delete(agentId: string, options?: { signal?: AbortSignal }): Promise<void>
```

Permanent. Messages the agent handled keep working and report their agent as
`ARCHIVED`.

---

## `client.skills`

A skill is a folder whose `SKILL.md` opens with YAML frontmatter (`name`,
`description`, and optionally `license`, `compatibility`, `metadata`,
`allowed-tools`, per the [agentskills.io](https://agentskills.io/specification)
specification), plus any supporting files. Give one to an agent with
`capabilities.skills.include`.

`create` and `uploadVersion` take a `SkillArchive`:

- a zip archive (`Blob`, `File`, `ArrayBuffer`, `Uint8Array`), sent as it is;
- or a `SkillFiles` object, the skill's files by `/`-separated path with
  `SKILL.md` at the root, zipped in memory. A string value is written as UTF-8.
  Entries with a path part starting with `.` are left out, as when zipping a
  folder.

An archive over 30 MB (`SKILL_MAX_BYTES`), a files object with no `SKILL.md` or
with an absolute or climbing (`..`) path, and a plain string all throw
`InvalidParams` before anything is sent. The server checks the frontmatter and
the layout: a refusal is an `APIError` (422) with the reason, a too-large archive
a 413.

### `skills.list(options?)`

```ts
list(options?: { signal?: AbortSignal }): Promise<Skill[]>
```

The built-in skills (`source: 'cominty'`), the organization's custom skills, and
the ones owned by the key's creator, each with its default version's
frontmatter.

### `skills.create(file, params)`

```ts
create(file: SkillArchive, params: CreateSkillParams): Promise<Skill>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `displayName` | `string` | **Required.** 1 to 100 characters. |
| `scope` | `Scope` | `'private'` (default) or `'organization'`. |
| `signal` | `AbortSignal` | Cancels the upload. |

### `skills.update(skillId, params)`

```ts
update(skillId: string, params: UpdateSkillParams): Promise<Skill>
```

Partial: `displayName`, `active` (whether agents may use the skill) or `scope`,
at least one. A built-in skill throws `NotFoundError`.

### `skills.uploadVersion(skillId, file, options?)`

```ts
uploadVersion(skillId: string, file: SkillArchive, options?: { signal?: AbortSignal }): Promise<Skill>
```

Upload a new version and make it the default. Versions are tagged to the second:
two uploads of the same skill within one second collide (500), so space them out.

### `skills.delete(skillId, options?)`

```ts
delete(skillId: string, options?: { signal?: AbortSignal }): Promise<void>
```

Permanent, every version included.

---

## `client.documents`

### `documents.get(documentId, options?)`

```ts
get(documentId: string, options?: { signal?: AbortSignal }): Promise<DocumentMetadata>
```

Resolve the composite document id of an agent citation to its source and file.
The id may contain `#`: it is sent URL-encoded. An id unknown to the key's
organization throws `NotFoundError`.

---

## `client.mcp`

### `mcp.list(params?)`

```ts
list(params?: { enabled?: boolean | null; signal?: AbortSignal }): Promise<McpServer[]>
```

The MCP integrations this key can use (`GET /mcp/manifest`). A server's `name` is
what `mcp.connections` takes, in `threadCapabilities`, `messageScope` or an
agent's `capabilities`. The endpoint returns every server; `enabled` filters on
`is_enabled` in the SDK: `true` (default) keeps the ones turned on, `false` only
the ones that are off, `null` every server. Leave servers that are off out of
`connections`.

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

Supporting types: `UploadSource`, `UploadFileParams`, `ExportFormat`,
`ExportMessageParams`; for capabilities, `Activation`, `All`, `AllowList`,
`SingleCapability`, `IndexedDocumentsCapability`, `McpCapability`,
`SkillsCapability`, `MemoryCapability`, `SingleScope`, `IndexedDocumentsScope`
and `McpScope`.

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

### `Source` and `SourceFile`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `number` | The id `indexedDocuments.sourceIds` takes |
| `pid` | `string` | The id every `client.sources` method takes |
| `name` | `string` |  |
| `status` | `SourceStatus` | `pending`, `syncing`, `synced`, `error`, `paused`, `archived`, ... |
| `store` | `SourceStore` | `draganddrop`, `googledrive` or `sharepoint` |
| `scope` | `Scope` |  |
| `config` | `Record<string, unknown>` | `{ meta, values }`; `values.drive_id` names the drive behind the source |
| `documents_synced`, `documents_failed`, `documents_embedded`, `oversized_documents` | `number` | Counts from the last sync |
| `size`, `embedded_size` | `number` | Bytes |
| `created_at`, `created_by` | `string` |  |
| `last_synced_at`, `archived_at` | `string \| null` | ISO-8601 timestamps |

A `SourceFile` has `id`, `name`, `size`, `mimetype`, `created_at` and
`updated_at`.

Supporting types: `SourceFileInput`, `NamedFile`, `CreateSourceParams`,
`UpdateSourceParams`, `WaitSyncedParams`.

### `AgentDetail` and `AgentSummary`

| Field | Type | Description |
| --- | --- | --- |
| `id`, `name` | `string` |  |
| `description` | `string \| null` |  |
| `capabilities` | `AgentCapabilities \| null` | **camelCase**, the shape you pass |
| `managed` | `boolean` | `true` for the built-in agents |
| `scope` | `Scope` |  |
| `owner` | `string` | The creator's Clerk id: for a key's agent, the admin who minted the key |
| `execution_options` | `object \| null` | Legacy: use `capabilities` |
| `memory_namespace` | `string \| null` | Legacy: use `capabilities.memory` |
| `instructions` | `string \| null` | **`AgentDetail` only** |
| `allow_execution_options_override` | `boolean` | **`AgentDetail` only** |
| `models` | `LlmModel[]` | **`AgentDetail` only.** `{ id, name }`, in failover order |

Supporting types: `CreateAgentParams`, `UpdateAgentParams`, `SetAgentModelsParams`.

### `Skill`

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | The id `skills.include` takes |
| `display_name` | `string` |  |
| `active` | `boolean` | Whether agents may use it |
| `scope` | `Scope \| null` | `null` for built-in skills |
| `source` | `SkillSource` | `'cominty'` (built in, read-only) or `'custom'` |
| `frontmatter` | `SkillFrontmatter` | `name`, `description`, `license`, `compatibility`, `metadata`, `allowed_tools` |
| `created_at` | `string` |  |
| `updated_at` | `string` | When the default version was uploaded |

Supporting types: `SkillArchive`, `SkillFiles`, `CreateSkillParams`,
`UpdateSkillParams`.

### `DocumentMetadata`

`document_id`, `document_name`, `document_extension`, `document_mime_type`,
`document_uri` (or `null`), and its source: `source_id`, `source_pid` and
`source_type` (a `SourceStore`).

### `McpServer`

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Stable id: the value `mcp.connections` takes |
| `title`, `description` | `string` | What to show |
| `is_enabled` | `boolean` | Turned on for this caller |
| `origin` | `string` | `builtin` or `remote` today; others may appear |
| `scope` | `string` | `organization` or `user` today |
| `requires_oauth_connect` | `boolean` | The user must connect OAuth before it can be used |

Optional, absent when the API leaves them out: `connection_status`, `icon_uri`,
`mcp_url`, `owner_id`, `created_at`, `updated_at`. Supporting type:
`ListMcpServersParams`.

`Scope`, used by sources, agents and skills, is `'private' | 'organization'`.

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
| `SourceSyncFailed` | `sources.waitSynced` saw the source stop | `source` |
| `SourceSyncTimeout` | `sources.waitSynced` ran out of time | `source` (or `null`) |
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
| `ALL` | `'*'` — the "no restriction" filter of a capability or scope |
| `UPLOAD_MAX_BYTES` | `524288000` (500 MiB) — maximum `chat.uploadFile` size |
| `SOURCE_MAX_FILES` | `50` — maximum files in one source |
| `SKILL_MAX_BYTES` | `31457280` (30 MB) — maximum skill archive size |
| `SKILL_DISPLAY_NAME_MAX_LENGTH` | `100` — maximum skill `displayName` length |
| `AGENT_DESCRIPTION_MAX_LENGTH` | `500` — maximum agent `description` length |
| `AGENT_INSTRUCTIONS_MAX_LENGTH` | `30000` — maximum agent `instructions` length |
| `DISABLE_ALL_MCP` | `'mcp:*'` — **deprecated**, with `disabledTools` |
| `DISABLE_MCP_PREFIX` | `'mcp:'` — **deprecated**, with `disabledTools` |
