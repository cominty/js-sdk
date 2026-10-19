# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, a minor release may contain breaking changes; they
are always called out under **Changed** or **Removed**.

## [Unreleased]

## [0.3.0] - 2026-10-19

### Added

- `threadCapabilities` on `client.chat.start`: overrides the agent's `web`,
  `indexedDocuments`, `mcp`, `skills`, `imageGeneration`, `videoGeneration`,
  `musicGeneration` and `memory` capabilities for the thread's whole life. Sent
  as `options.capabilities`.
- `messageScope` on `client.chat.start` and `client.chat.send`: turns
  capabilities on or off, or narrows their allowlists, for one message. Sent as
  `message.scope`.
- `ALL` (`'*'`), the "no restriction" filter, and the `AgentCapabilities`,
  `MessageScope` and related types.
- `client.chat.cancel(messageId)`, to stop an assistant message that is still
  being generated.
- `client.chat.export(messageId, { format })`, returning a finished message as
  PDF or DOCX bytes.
- `client.chat.uploadFile(file, { filename, mimetype })`, the whole presigned
  upload of a `Blob`, `File`, `ArrayBuffer` or `Uint8Array`, returning the
  `ConversationFile` whose `id` goes in `fileIds`; and
  `client.chat.downloadFile(fileId)`, returning a conversation file's bytes. The
  API key is never sent to the storage backend. `UPLOAD_MAX_BYTES` is the 500 MiB
  limit.
- `InvalidParams` for `threadCapabilities` on `chat.send`, `messageScope`
  together with `sourceIds`, `documentIds` or `disabledTools`, and
  `memoryNamespace` together with `threadCapabilities.memory`.

### Deprecated

- `sourceIds`, `documentIds` and `disabledTools` on `chat.start` and
  `chat.send`, with `DisablableTool`, `DISABLE_MCP_PREFIX` and `DISABLE_ALL_MCP`:
  use `messageScope`. They still work on their own.
- `memoryNamespace` on `chat.start`: use
  `threadCapabilities: { memory: { activation: 'always', namespace } }`. It still
  works on its own.

## [0.2.0] - 2026-10-07

### Added

- `maxSteps` on `client.chat.start` and `client.chat.send`, a cap on the agent's
  tool rounds for one message.
- `memoryNamespace` on `client.chat.start`, the memory namespace the thread reads
  and writes for its whole life.
- `client.memory.list`, `listNamespaces`, `create`, `get`, `update` and `delete`,
  for the memory files in a namespace.

### Fixed

- `InvalidParams` reported a `NaN` or `Infinity` argument as `null`, and threw a
  `TypeError` instead when given a `bigint`.

## [0.1.0] - 2026-09-28

First public release.

### Added

- `Cominty` client, configured by options or the `COMINTY_API_KEY`,
  `COMINTY_USER_ID` and `COMINTY_BASE_URL` environment variables.
- `client.chat.start`, `client.chat.send` and `client.chat.stream`, returning a
  run you can iterate for progress events or await for the final message.
- `client.threads.list`, `get`, `update` and `archive`.
- Typed stream events as a discriminated union, with `isKnownEvent` for
  forward compatibility.
- Typed error hierarchy rooted at `ComintyError`.
- Client-side parameter validation that reports every invalid argument at once.

[Unreleased]: https://github.com/cominty/js-sdk/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cominty/js-sdk/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cominty/js-sdk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cominty/js-sdk/releases/tag/v0.1.0
