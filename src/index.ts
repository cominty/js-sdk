/**
 * Official TypeScript client for the Cominty managed agent chat API.
 *
 * ```ts
 * import { Cominty } from '@cominty-ai/sdk'
 *
 * const client = new Cominty()          // COMINTY_API_KEY + COMINTY_USER_ID
 * const run = await client.chat.start({
 *     agentId: '__cominty_agents::agent.chat',
 *     message: 'What is Cominty?',
 * })
 * console.log(await run.text())
 * ```
 */

export { Cominty } from './client.ts'
export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, type ComintyOptions } from './config.ts'

export {
    APIConnectionError,
    APIError,
    AuthError,
    ComintyError,
    ConflictError,
    InvalidParams,
    NotFoundError,
    PermissionError,
    RateLimitError,
    SDKError,
    ServerError,
    StreamInterrupted,
    type ErrorDetail,
    type InvalidParam,
    type RateLimitScope,
} from './errors.ts'

export {
    isFailureStatus,
    isKnownEvent,
    isTerminalStatus,
    type AgentFile,
    type AnyEvent,
    type Cost,
    type EventStatus,
    type IntermediaryUpdateEvent,
    type KnownEvent,
    type LlmEvent,
    type ResultEvent,
    type SettingUpSandboxEvent,
    type ToolCallEvent,
    type UnknownEvent,
    type UploadingFileEvent,
    type WaitingForStartEvent,
} from './events.ts'

export {
    CONTENT_MAX_LENGTH,
    DISABLE_ALL_MCP,
    DISABLE_MCP_PREFIX,
    MAX_FILES,
    validateUserId,
    type Agent,
    type ContentOrigin,
    type ConversationFile,
    type DisablableTool,
    type Message,
    type MessageParams,
    type MessageRole,
    type MessageStatus,
    type Question,
    type ShareLink,
    type StartChatParams,
    type Thread,
    type ThreadSummary,
    type UpdateThreadParams,
} from './models/chat.ts'

export type {
    CreateMemoryFileParams,
    ListMemoryFilesParams,
    MemoryFile,
    MemoryFileSummary,
    UpdateMemoryFileParams,
} from './models/memory.ts'

export { AssistantRun, StartedChat } from './streaming.ts'
export type { ListThreadsParams } from './resources/threads.ts'
export type { ChatResource } from './resources/chat.ts'
export type { MemoryResource } from './resources/memory.ts'
export type { ThreadsResource } from './resources/threads.ts'
