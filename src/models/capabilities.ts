/**
 * Capabilities and message scope: what an agent may use, for a whole thread and
 * for one message.
 *
 * A thread capability (`threadCapabilities` on `chat.start`) installs or removes
 * one of the agent's capabilities for the thread's whole life. A message scope
 * (`messageScope` on `chat.start` and `chat.send`) turns one on or off, or narrows
 * its allowlist, for a single message.
 *
 * Validated as strictly as the rest of the chat arguments: there are no
 * shortcuts (`web: true`), the activation is always required, and every problem
 * is collected into the caller's {@link InvalidParams}. Keys are camelCase here
 * and snake_case on the wire.
 */

import type { InvalidParam } from '../errors.ts'
import { checkNamespace } from './memory.ts'

/**
 * Allowlist marker meaning "no restriction": every id the end user can access.
 * It is the default of every filter, so pass it only to make the intent explicit.
 */
export const ALL = '*'

/** The type of {@link ALL}. */
export type All = typeof ALL

/**
 * `always`: on by default. `on_request`: installed but off until a message turns
 * it on. `never`: not installed.
 */
export type Activation = 'always' | 'on_request' | 'never'

/** A filter: {@link ALL}, or a non-empty list of ids. */
export type AllowList<T> = readonly T[] | All

// ── Thread level ──────────────────────────────────────────────────────────── //

/** `web`, `imageGeneration`, `videoGeneration` and `musicGeneration`: no filter. */
export interface SingleCapability {
    activation: Activation
}

export type IndexedDocumentsCapability =
    | {
          activation: 'always' | 'on_request'
          /** Knowledge sources the agent may search. Defaults to {@link ALL}. */
          sourceIds?: AllowList<number>
          /** Documents the agent may search. Defaults to {@link ALL}. */
          documentIds?: AllowList<string>
      }
    | { activation: 'never' }

export type McpCapability =
    | {
          activation: 'always' | 'on_request'
          /** Connected MCP servers the agent may call. Defaults to {@link ALL}. */
          connections?: AllowList<string>
      }
    | { activation: 'never' }

/** Skills have no `on_request`. */
export type SkillsCapability =
    | {
          activation: 'always'
          /** Skills the agent may load. Defaults to {@link ALL}. */
          include?: AllowList<string>
      }
    | { activation: 'never' }

/** Memory has no `on_request`. `always` needs the namespace, `never` takes none. */
export type MemoryCapability =
    | {
          activation: 'always'
          /** The memory namespace the thread reads and writes. 1 to 128 characters. */
          namespace: string
      }
    | { activation: 'never' }

/**
 * Overrides some of the agent's capabilities for one thread, frozen for its whole
 * life. Each capability you pass replaces the agent's, so a filter you leave out
 * resets to {@link ALL}; the ones you leave out keep the agent's value.
 */
export interface AgentCapabilities {
    web?: SingleCapability
    indexedDocuments?: IndexedDocumentsCapability
    mcp?: McpCapability
    skills?: SkillsCapability
    imageGeneration?: SingleCapability
    videoGeneration?: SingleCapability
    musicGeneration?: SingleCapability
    /**
     * The thread's memory bag. Left out, the thread uses the agent's namespace, or
     * runs without memory if the agent has none.
     */
    memory?: MemoryCapability
}

// ── Message level ─────────────────────────────────────────────────────────── //

/** `web`, `imageGeneration`, `videoGeneration` and `musicGeneration`: no filter. */
export interface SingleScope {
    enabled: boolean
}

export type IndexedDocumentsScope =
    | { enabled: true; sourceIds?: AllowList<number>; documentIds?: AllowList<string> }
    | { enabled: false }

export type McpScope = { enabled: true; connections?: AllowList<string> } | { enabled: false }

/**
 * Turns capabilities on or off, or narrows their allowlists, for one message. A
 * message can only narrow what the thread allows. There is no `skills` or
 * `memory` scope: both are set for the whole thread.
 */
export interface MessageScope {
    web?: SingleScope
    indexedDocuments?: IndexedDocumentsScope
    mcp?: McpScope
    imageGeneration?: SingleScope
    videoGeneration?: SingleScope
    musicGeneration?: SingleScope
}

// ── Validation + wire mapping ─────────────────────────────────────────────── //

interface FilterSpec {
    key: string
    wire: string
    item: 'integer' | 'string'
}

interface EntrySpec {
    wire: string
    activations: readonly Activation[]
    filters: readonly FilterSpec[]
}

const SOURCE_IDS: FilterSpec = { key: 'sourceIds', wire: 'source_ids', item: 'integer' }
const DOCUMENT_IDS: FilterSpec = { key: 'documentIds', wire: 'document_ids', item: 'string' }
const CONNECTIONS: FilterSpec = { key: 'connections', wire: 'connections', item: 'string' }
const INCLUDE: FilterSpec = { key: 'include', wire: 'include', item: 'string' }

const ANY_ACTIVATION: readonly Activation[] = ['always', 'on_request', 'never']
const INSTALLED_OR_NOT: readonly Activation[] = ['always', 'never']

const CAPABILITIES: Record<string, EntrySpec> = {
    web: { wire: 'web', activations: ANY_ACTIVATION, filters: [] },
    indexedDocuments: {
        wire: 'indexed_documents',
        activations: ANY_ACTIVATION,
        filters: [SOURCE_IDS, DOCUMENT_IDS],
    },
    mcp: { wire: 'mcp', activations: ANY_ACTIVATION, filters: [CONNECTIONS] },
    skills: { wire: 'skills', activations: INSTALLED_OR_NOT, filters: [INCLUDE] },
    imageGeneration: { wire: 'image_generation', activations: ANY_ACTIVATION, filters: [] },
    videoGeneration: { wire: 'video_generation', activations: ANY_ACTIVATION, filters: [] },
    musicGeneration: { wire: 'music_generation', activations: ANY_ACTIVATION, filters: [] },
    memory: { wire: 'memory', activations: INSTALLED_OR_NOT, filters: [] },
}

const SCOPES: Record<string, Omit<EntrySpec, 'activations'>> = {
    web: { wire: 'web', filters: [] },
    indexedDocuments: { wire: 'indexed_documents', filters: [SOURCE_IDS, DOCUMENT_IDS] },
    mcp: { wire: 'mcp', filters: [CONNECTIONS] },
    imageGeneration: { wire: 'image_generation', filters: [] },
    videoGeneration: { wire: 'video_generation', filters: [] },
    musicGeneration: { wire: 'music_generation', filters: [] },
}

/** Why a message scope refuses a key that is a thread capability. */
const THREAD_ONLY: Record<string, string> = {
    skills: 'a message has no skills scope: skills are set for the whole thread, in threadCapabilities.skills',
    memory: "a message has no memory scope: a thread's memory is set once, in threadCapabilities.memory",
}

const NO_FILTER_WHEN_OFF = 'not accepted when the capability is off: it takes no filter'

type Wire = Record<string, unknown>

/**
 * Check `threadCapabilities` and build its wire form, or `undefined` when it was
 * left out. Problems go to `errors`; the result is meaningless if any were added.
 */
export function buildCapabilities(
    errors: InvalidParam[],
    param: string,
    value: unknown,
): Wire | undefined {
    if (value === undefined) return undefined
    if (!isObject(value)) {
        errors.push({
            param,
            message: "must be an object like { web: { activation: 'always' } }",
            input: value,
        })
        return undefined
    }
    checkKeys(errors, param, value, Object.keys(CAPABILITIES))

    const wire: Wire = {}
    for (const [name, spec] of Object.entries(CAPABILITIES)) {
        const entry = value[name]
        if (entry === undefined) continue
        wire[spec.wire] =
            name === 'memory'
                ? memoryCapability(errors, `${param}.${name}`, entry)
                : capability(errors, `${param}.${name}`, name, spec, entry)
    }
    return wire
}

/**
 * Check `messageScope` and build its wire form, or `undefined` when it was left
 * out. Problems go to `errors`; the result is meaningless if any were added.
 */
export function buildScope(
    errors: InvalidParam[],
    param: string,
    value: unknown,
): Wire | undefined {
    if (value === undefined) return undefined
    if (!isObject(value)) {
        errors.push({
            param,
            message: 'must be an object like { web: { enabled: false } }',
            input: value,
        })
        return undefined
    }
    for (const key of Object.keys(value)) {
        if (key in THREAD_ONLY)
            errors.push({ param: `${param}.${key}`, message: THREAD_ONLY[key]! })
    }
    checkKeys(errors, param, value, [...Object.keys(SCOPES), ...Object.keys(THREAD_ONLY)])

    const wire: Wire = {}
    for (const [name, spec] of Object.entries(SCOPES)) {
        const entry = value[name]
        if (entry === undefined) continue
        wire[spec.wire] = scope(errors, `${param}.${name}`, spec, entry)
    }
    return wire
}

function capability(
    errors: InvalidParam[],
    param: string,
    name: string,
    spec: EntrySpec,
    value: unknown,
): Wire | undefined {
    if (!isObject(value)) {
        errors.push({
            param,
            message:
                "must be an object like { activation: 'always' }; leave it out to keep the agent's value",
            input: value,
        })
        return undefined
    }
    checkKeys(errors, param, value, ['activation', ...spec.filters.map((f) => f.key)])
    const activation = checkActivation(errors, param, name, spec.activations, value.activation)

    const wire: Wire = { activation }
    for (const filter of spec.filters) {
        const raw = value[filter.key]
        if (activation === 'never') {
            if (raw !== undefined) {
                errors.push({
                    param: `${param}.${filter.key}`,
                    message: NO_FILTER_WHEN_OFF,
                    input: raw,
                })
            }
            continue
        }
        wire[filter.wire] = allowList(errors, `${param}.${filter.key}`, filter.item, raw)
    }
    // `never` sends nothing else: the API's never shape takes no field.
    return activation === 'never' ? { activation: 'never' } : wire
}

function memoryCapability(errors: InvalidParam[], param: string, value: unknown): Wire | undefined {
    if (!isObject(value)) {
        errors.push({
            param,
            message:
                "must be an object like { activation: 'always', namespace: 'support-bot' }; " +
                "leave it out to keep the agent's value",
            input: value,
        })
        return undefined
    }
    checkKeys(errors, param, value, ['activation', 'namespace'])
    const activation = checkActivation(errors, param, 'memory', INSTALLED_OR_NOT, value.activation)
    const namespace = value.namespace

    if (activation === 'never') {
        if (namespace !== undefined) {
            errors.push({
                param: `${param}.namespace`,
                message: "not accepted with activation 'never': memory is off",
                input: namespace,
            })
        }
        return { activation: 'never' }
    }
    if (activation === 'always') {
        if (namespace === undefined || namespace === null) {
            errors.push({
                param: `${param}.namespace`,
                message:
                    "required when activation is 'always': the memory bag the thread reads and writes",
                input: namespace ?? undefined,
            })
        } else if (namespace === '') {
            errors.push({
                param: `${param}.namespace`,
                message: 'must not be empty',
                input: namespace,
            })
        } else {
            checkNamespace(errors, `${param}.namespace`, namespace)
        }
    }
    return { activation, namespace }
}

function scope(
    errors: InvalidParam[],
    param: string,
    spec: Omit<EntrySpec, 'activations'>,
    value: unknown,
): Wire | undefined {
    if (!isObject(value)) {
        errors.push({ param, message: 'must be an object like { enabled: true }', input: value })
        return undefined
    }
    checkKeys(errors, param, value, ['enabled', ...spec.filters.map((f) => f.key)])
    const enabled = value.enabled
    if (typeof enabled !== 'boolean') {
        errors.push({
            param: `${param}.enabled`,
            message:
                enabled === undefined ? 'required, must be true or false' : 'must be true or false',
            input: enabled,
        })
    }

    const wire: Wire = { enabled }
    for (const filter of spec.filters) {
        const raw = value[filter.key]
        if (enabled === false) {
            if (raw !== undefined) {
                errors.push({
                    param: `${param}.${filter.key}`,
                    message: NO_FILTER_WHEN_OFF,
                    input: raw,
                })
            }
            continue
        }
        wire[filter.wire] = allowList(errors, `${param}.${filter.key}`, filter.item, raw)
    }
    return enabled === false ? { enabled: false } : wire
}

function checkActivation(
    errors: InvalidParam[],
    param: string,
    name: string,
    allowed: readonly Activation[],
    value: unknown,
): unknown {
    if (allowed.includes(value as Activation)) return value
    const choices = allowed.map((a) => `'${a}'`).join(', ')
    let message =
        value === undefined ? `required, must be one of ${choices}` : `must be one of ${choices}`
    if (value === 'on_request') message += `: ${name} has no 'on_request'`
    errors.push({ param: `${param}.activation`, message, input: value })
    return value
}

/** A filter left out is {@link ALL}; `null`, `[]` and a `'*'` inside a list are refused. */
function allowList(
    errors: InvalidParam[],
    param: string,
    item: FilterSpec['item'],
    value: unknown,
): unknown {
    if (value === undefined || value === ALL) return ALL
    if (value === null) {
        errors.push({
            param,
            message:
                "null is not accepted: pass ALL ('*') for no restriction, or a non-empty array",
        })
    } else if (!Array.isArray(value)) {
        errors.push({
            param,
            message: `must be ALL ('*') or a non-empty array of ${item}s`,
            input: value,
        })
    } else if (value.length === 0) {
        errors.push({
            param,
            message:
                'an empty array is ambiguous: pass ALL for no restriction, or turn the capability off instead',
        })
    } else {
        value.forEach((v, i) => {
            if (v === ALL) {
                errors.push({
                    param: `${param}[${i}]`,
                    message:
                        "'*' inside an array is not accepted: pass ALL on its own for every id",
                })
            } else if (item === 'integer' ? !Number.isInteger(v) : typeof v !== 'string') {
                errors.push({
                    param: `${param}[${i}]`,
                    message: item === 'integer' ? 'must be an integer' : 'must be a string',
                    input: v,
                })
            }
        })
        return [...value]
    }
    return value
}

/** Refuse keys outside `allowed`, pointing a snake_case one to its camelCase name. */
function checkKeys(
    errors: InvalidParam[],
    param: string,
    value: Record<string, unknown>,
    allowed: readonly string[],
): void {
    for (const key of Object.keys(value)) {
        if (allowed.includes(key)) continue
        const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
        errors.push({
            param: `${param}.${key}`,
            message: allowed.includes(camel)
                ? `unknown key: arguments are camelCase, use '${camel}'`
                : `unknown key, expected one of ${allowed.join(', ')}`,
        })
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
