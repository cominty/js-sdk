/**
 * Typed events emitted by `GET /chat/messages/{message_id}/stream`.
 *
 * The chat stream is **progress streaming, not token streaming** — there is no
 * text-delta event. The assistant's reply arrives whole, once, inside the
 * `result` event (`data.reply`) and again in the terminal message snapshot.
 *
 * Narrow with `event.name` — TypeScript discriminates the union natively, so
 * there is no equivalent of Python's `isinstance` checks. Guard with
 * {@link isKnownEvent} first: the forward-compat {@link UnknownEvent} member has
 * `name: string`, which overlaps every literal and would otherwise keep the
 * narrowed type wide.
 *
 * ```ts
 * for await (const event of run) {
 *     if (!isKnownEvent(event)) continue   // an event a newer server added
 *     if (event.name === 'tool_call') console.log(event.data.name, event.status)
 * }
 * ```
 */

import type { Question } from './models/chat.ts'

/**
 * Event lifecycle status.
 *
 * Note this is wider than the Python SDK's union: the backend emits `failed` for
 * a failed tool call, which that union omits.
 */
export type EventStatus = 'running' | 'success' | 'failed' | 'error'

interface EventBase {
    /**
     * Redis stream id, e.g. `"1718000000000-0"`. The SDK tracks the last one seen
     * and replays from it via `Last-Event-Id` when a stream drops.
     */
    id: string
    /** One logical step: a sandbox setup, an LLM call, a tool call. */
    correlation_id: number
    /** ISO-8601 timestamp. */
    at: string
    status: EventStatus
}

export interface AgentFile {
    id: string
    name: string
    mimetype: string
}

/**
 * What the run cost.
 *
 * The money fields arrive as decimal **strings** and stay strings. Parsing them
 * to `number` loses precision when summed; use a decimal library if you need to
 * add them up.
 */
export interface Cost {
    failed: boolean
    input_tokens: number
    cached_tokens: number
    output_tokens: number
    input_cost: string
    output_cost: string
    total: string
}

/** The run is queued, waiting for a worker. */
export interface WaitingForStartEvent extends EventBase {
    name: 'waiting_for_start'
}

/** The execution sandbox is being provisioned. */
export interface SettingUpSandboxEvent extends EventBase {
    name: 'setting_up_sandbox'
}

export interface UploadingFileEvent extends EventBase {
    name: 'uploading_file'
    data: { filename: string }
}

/** An LLM call. `data.model` is the model that served it. */
export interface LlmEvent extends EventBase {
    name: 'llm'
    data: { description: string; model: string; error?: string }
}

/** A human-readable progress note from the agent. */
export interface IntermediaryUpdateEvent extends EventBase {
    name: 'intermediary_update'
    data: { message: string }
}

/** A tool call. `status` discriminates the phase. */
export interface ToolCallEvent extends EventBase {
    name: 'tool_call'
    data: {
        name: string
        description: string
        /** Present when `status === 'success'`. */
        message?: string
        /** Present when `status` is `'failed'` or `'error'`. */
        error?: string
    }
}

/**
 * The agent's answer.
 *
 * Emitted **mid-stream** — it is not a terminator. More events can follow it, and
 * the stream ends with the terminal message snapshot instead.
 */
export interface ResultEvent extends EventBase {
    name: 'result'
    data: {
        reply: string
        files: AgentFile[]
        questions?: Question[] | null
        /** Agent-specific: `agent.planner` -> `{ canvas }`; `agent.hive` -> null. */
        metadata?: Record<string, unknown> | null
        cost: Cost
    }
}

/**
 * Forward-compat fallback for an event `name` this SDK version does not model.
 * The server can add events without breaking old clients.
 *
 * Because `name` is `string`, this member overlaps every literal in the union —
 * call {@link isKnownEvent} before switching on `name`.
 */
export interface UnknownEvent extends EventBase {
    name: string
    data?: Record<string, unknown>
}

export type KnownEvent =
    | WaitingForStartEvent
    | SettingUpSandboxEvent
    | UploadingFileEvent
    | LlmEvent
    | IntermediaryUpdateEvent
    | ToolCallEvent
    | ResultEvent

export type AnyEvent = KnownEvent | UnknownEvent

const KNOWN_NAMES = new Set([
    'waiting_for_start',
    'setting_up_sandbox',
    'uploading_file',
    'llm',
    'intermediary_update',
    'tool_call',
    'result',
])

/**
 * Parse one decoded JSONL line into a typed event.
 *
 * Handles *event* lines only — telling events from terminal message snapshots is
 * the stream layer's job (events are the lines carrying a `correlation_id`).
 * Unknown names degrade to {@link UnknownEvent} rather than throwing.
 */
export function parseEvent(obj: Record<string, unknown>): AnyEvent {
    return obj as unknown as AnyEvent
}

/**
 * Narrow a stream event to the union this SDK version models.
 *
 * Use it before switching on `event.name`: it removes {@link UnknownEvent} from
 * the union, which is what lets TypeScript discriminate the rest and give each
 * branch its real `data` type.
 */
export function isKnownEvent(event: AnyEvent): event is KnownEvent {
    return KNOWN_NAMES.has(event.name)
}

/** `true` for `failed` and `error`. */
export function isFailureStatus(status: EventStatus): boolean {
    return status === 'failed' || status === 'error'
}

/** `true` once a step can emit nothing further. */
export function isTerminalStatus(status: EventStatus): boolean {
    return status === 'success' || status === 'failed' || status === 'error'
}
