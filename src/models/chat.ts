/**
 * Request and response types for the chat resource.
 *
 * Requests are validated strictly, so a caller mistake surfaces locally with the
 * offending argument named. Responses are typed loosely — extra fields are kept
 * and unknown ones ignored — so the SDK tolerates additive API changes without a
 * release.
 *
 * Arguments are camelCase; the wire is snake_case. The mapping lives here and
 * nowhere else.
 */

import { InvalidParams, SDKError, type InvalidParam } from '../errors.ts'

/** Max content length, enforced server-side (`CHAT_MESSAGE_MAX_LENGTH`). */
export const CONTENT_MAX_LENGTH = 30_000
/** Max files per message (`CHAT_MESSAGE_MAX_FILES`). */
export const MAX_FILES = 5

/** Prefix that disables a single MCP server, e.g. `mcp:slack`. */
export const DISABLE_MCP_PREFIX = 'mcp:'
/** Disables every connected MCP server at once. */
export const DISABLE_ALL_MCP = `${DISABLE_MCP_PREFIX}*`

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
export type ContentOrigin = 'user' | 'agent'

/**
 * A tool the agent may disable: the built-in `web` / `company_documents`, or an
 * MCP token `mcp:<server>` (`mcp:*` for all).
 */
export type DisablableTool = 'web' | 'company_documents' | `mcp:${string}`

/** Cominty user ids are Clerk-issued: `user_` + a base58-ish token. */
const USER_ID_PATTERN = /^user_[A-Za-z0-9]{20,}$/

/**
 * Throws unless `value` is a well-formed Cominty user id.
 *
 * Called by the client constructor so a typo fails at construction rather than
 * as a server 400/404 on the first call.
 */
export function validateUserId(value: string): string {
    if (!USER_ID_PATTERN.test(value)) {
        throw new Error(
            "expected a Cominty user id like 'user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ' ('user_' prefix + " +
                'alphanumeric token). Find yours at platform.cominty.ai -> avatar (top right) -> Profile',
        )
    }
    return value
}

// ── Responses ─────────────────────────────────────────────────────────────── //

/** A clarifying question the agent is asking instead of answering. */
export interface Question {
    prompt: string
    options: string[]
}

export interface Agent {
    id: string
    name: string
}

export interface ShareLink {
    id: string
    created_at: string
    last_accessed_at: string | null
    access_count: number
    revoked: boolean
    expires_at: string | null
    expired: boolean
    protected: boolean
    url: string
}

export interface ConversationFile {
    id: string
    name: string
    size: number
    mimetype: string
    origin: ContentOrigin
    share_links: ShareLink[]
    url: string
}

export interface Message {
    id: string
    thread_id: string
    role: MessageRole
    content: string
    questions: Question[] | null
    live: boolean
    status: MessageStatus
    /** Raw persisted event log — not the typed stream events. */
    events: Record<string, unknown>[] | null
    structured_output: Record<string, unknown> | null
    files: ConversationFile[]
    [key: string]: unknown
}

export interface ThreadSummary {
    id: string
    name: string
    created_at: string
    live: boolean
    agent: Agent
    starred: boolean
    project_id?: string | null
    [key: string]: unknown
}

export interface Thread extends ThreadSummary {
    messages: Message[]
}

// ── Request params ────────────────────────────────────────────────────────── //

/** Options shared by `chat.start` and `chat.send`. */
export interface MessageParams {
    /** The agent to run. Copy an id from platform.cominty.ai/agents. */
    agentId: string
    /** The user's message. Max 30,000 characters. */
    message: string
    /** Attach previously-uploaded files. Max 5. */
    fileIds?: string[]
    /** Restrict retrieval to specific knowledge sources. */
    sourceIds?: number[]
    /** Restrict retrieval to specific documents. */
    documentIds?: string[]
    /** Turn tools off for this message. */
    disabledTools?: DisablableTool[]
    /** Abort the request. */
    signal?: AbortSignal
}

/** `chat.start` additionally names the new thread. */
export interface StartChatParams extends MessageParams {
    name?: string
}

export interface UpdateThreadParams {
    name?: string
    starred?: boolean
    signal?: AbortSignal
}

// ── Validation + wire mapping ─────────────────────────────────────────────── //

interface ChatBody {
    name?: string
    message: {
        content: string
        file_ids?: string[]
        source_ids?: number[]
        document_ids?: string[]
        disabled_tools?: string[]
    }
    options: { agent_id: string; user_id: string }
}

/**
 * Validate caller arguments and build the wire body in one pass.
 *
 * `userId` comes from the client, never the caller — it is set once and applied
 * to every request, exactly as in the Python SDK.
 */
export function buildChatBody(params: StartChatParams, userId: string, context: string): ChatBody {
    const errors: InvalidParam[] = []

    if (typeof params.agentId !== 'string' || params.agentId.length === 0) {
        errors.push({ param: 'agentId', message: 'required, must be a non-empty string' })
    }
    if (typeof params.message !== 'string') {
        errors.push({
            param: 'message',
            message: 'required, must be a string',
            input: params.message,
        })
    } else if (params.message.length > CONTENT_MAX_LENGTH) {
        errors.push({
            param: 'message',
            message: `must be at most ${CONTENT_MAX_LENGTH} characters, got ${params.message.length}`,
        })
    }
    if (params.name !== undefined && typeof params.name !== 'string') {
        errors.push({ param: 'name', message: 'must be a string', input: params.name })
    }

    checkStringArray(errors, 'fileIds', params.fileIds, MAX_FILES)
    checkStringArray(errors, 'documentIds', params.documentIds)
    if (params.sourceIds !== undefined) {
        if (!Array.isArray(params.sourceIds)) {
            errors.push({
                param: 'sourceIds',
                message: 'must be an array of integers',
                input: params.sourceIds,
            })
        } else {
            params.sourceIds.forEach((v, i) => {
                if (!Number.isInteger(v)) {
                    errors.push({
                        param: `sourceIds[${i}]`,
                        message: 'must be an integer',
                        input: v,
                    })
                }
            })
        }
    }
    if (params.disabledTools !== undefined) {
        if (!Array.isArray(params.disabledTools)) {
            errors.push({
                param: 'disabledTools',
                message: 'must be an array',
                input: params.disabledTools,
            })
        } else {
            params.disabledTools.forEach((v, i) => {
                const ok =
                    v === 'web' ||
                    v === 'company_documents' ||
                    (typeof v === 'string' &&
                        v.startsWith(DISABLE_MCP_PREFIX) &&
                        v.length > DISABLE_MCP_PREFIX.length)
                if (!ok) {
                    errors.push({
                        param: `disabledTools[${i}]`,
                        message: `must be 'web', 'company_documents', or 'mcp:<server>'`,
                        input: v,
                    })
                }
            })
        }
    }

    if (errors.length > 0) throw new InvalidParams(context, errors)

    // `exclude_none` equivalent: omitted keys rather than explicit nulls.
    const message: ChatBody['message'] = { content: params.message }
    if (params.fileIds !== undefined) message.file_ids = params.fileIds
    if (params.sourceIds !== undefined) message.source_ids = params.sourceIds
    if (params.documentIds !== undefined) message.document_ids = params.documentIds
    if (params.disabledTools !== undefined) message.disabled_tools = params.disabledTools

    const body: ChatBody = { message, options: { agent_id: params.agentId, user_id: userId } }
    if (params.name !== undefined) body.name = params.name
    return body
}

function checkStringArray(
    errors: InvalidParam[],
    param: string,
    value: unknown,
    max?: number,
): void {
    if (value === undefined) return
    if (!Array.isArray(value)) {
        errors.push({ param, message: 'must be an array of strings', input: value })
        return
    }
    if (max !== undefined && value.length > max) {
        errors.push({ param, message: `must contain at most ${max} items, got ${value.length}` })
    }
    value.forEach((v, i) => {
        if (typeof v !== 'string') {
            errors.push({ param: `${param}[${i}]`, message: 'must be a string', input: v })
        }
    })
}

/** Find the assistant message a freshly started thread is streaming. */
export function liveAssistantMessage(thread: Thread): Message {
    const messages = thread.messages ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]!
        if (msg.role === 'assistant') return msg
    }
    throw new SDKError('started thread contained no assistant message to stream')
}
