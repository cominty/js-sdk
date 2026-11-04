/**
 * Request and response types for the agents resource.
 *
 * Responses are snake_case like the rest, except `capabilities`: it is read back
 * into the camelCase {@link AgentCapabilities} the SDK takes, so it can be passed
 * to `agents.update` as it is.
 */

import { InvalidParams, type InvalidParam } from '../errors.ts'
import { buildCapabilities, parseCapabilities, type AgentCapabilities } from './capabilities.ts'
import { checkKeys, checkScope, isObject, type Scope } from './common.ts'
import { characterCount } from './memory.ts'

/** Max description length (`CUSTOM_AGENT_DESCRIPTION_MAX_LENGTH`). */
export const AGENT_DESCRIPTION_MAX_LENGTH = 500
/** Max instructions length (`CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH`). */
export const AGENT_INSTRUCTIONS_MAX_LENGTH = 30_000

// ── Responses ─────────────────────────────────────────────────────────────── //

/** A language model an agent can run on. */
export interface LlmModel {
    id: string
    name: string
    [key: string]: unknown
}

/** An agent as `agents.list` returns it: no `instructions` or `models`. */
export interface AgentSummary {
    id: string
    name: string
    description: string | null
    /** camelCase, as `agents.create` and `agents.update` take it. */
    capabilities: AgentCapabilities | null
    /** Legacy tool configuration. New agents describe this through `capabilities`. */
    execution_options: Record<string, unknown> | null
    /** Legacy. Use `capabilities.memory`. */
    memory_namespace: string | null
    /** `true` for the built-in Cominty agents, which cannot be edited or deleted. */
    managed: boolean
    scope: Scope
    /**
     * Clerk user id of the creator. For an agent created with an API key, the
     * admin who minted the key: the `userId` to chat with over the key's sources.
     */
    owner: string
    [key: string]: unknown
}

export interface AgentDetail extends AgentSummary {
    instructions: string | null
    allow_execution_options_override: boolean
    /** Model chain, in failover order. */
    models: LlmModel[]
}

// ── Request params ────────────────────────────────────────────────────────── //

export interface CreateAgentParams {
    /** Display name. Must not be empty. */
    name: string
    /** At most 500 characters. */
    description?: string
    /** System instructions, at most 30 000 characters. */
    instructions?: string
    /** `'private'` (the owner only, default) or `'organization'`. */
    scope?: Scope
    /**
     * Tools the agent may use. Left-out capabilities keep the platform defaults.
     * `capabilities.memory` sets the agent's memory namespace.
     */
    capabilities?: AgentCapabilities
    /** Let a chat override the agent's tool configuration. Default `false`. */
    allowExecutionOptionsOverride?: boolean
    /** Model chain in failover order, from `agents.listModels`. Left out: the default. */
    modelIds?: readonly string[]
    signal?: AbortSignal
}

/**
 * A partial update: only the fields you pass are sent. `null` clears
 * `description`, `instructions` or `capabilities`; the other fields cannot be
 * cleared.
 */
export interface UpdateAgentParams {
    name?: string
    description?: string | null
    instructions?: string | null
    scope?: Scope
    /**
     * Merged key by key into the agent's: each capability you pass replaces the
     * stored one, the others stay. `null` clears them all.
     */
    capabilities?: AgentCapabilities | null
    allowExecutionOptionsOverride?: boolean
    signal?: AbortSignal
}

export interface SetAgentModelsParams {
    /** At least one model id, in failover order. */
    modelIds: readonly string[]
    signal?: AbortSignal
}

// ── Validation + wire mapping ─────────────────────────────────────────────── //

type Body = Record<string, unknown>

const CREATE_KEYS = [
    'name',
    'description',
    'instructions',
    'scope',
    'capabilities',
    'allowExecutionOptionsOverride',
    'modelIds',
    'signal',
]
const UPDATE_KEYS = CREATE_KEYS.filter((key) => key !== 'modelIds')

/** Validate `agents.create` arguments and build the body of `POST /agents`. */
export function buildCreateAgentBody(params: CreateAgentParams): Body {
    const value = (params ?? {}) as unknown as Record<string, unknown>
    const errors: InvalidParam[] = []
    checkKeys(errors, value, CREATE_KEYS)
    checkName(errors, value.name, true)
    checkText(errors, 'description', value.description, AGENT_DESCRIPTION_MAX_LENGTH, false)
    checkText(errors, 'instructions', value.instructions, AGENT_INSTRUCTIONS_MAX_LENGTH, false)
    checkScope(errors, 'scope', value.scope)
    const capabilities = buildCapabilities(errors, 'capabilities', value.capabilities)
    checkBoolean(errors, 'allowExecutionOptionsOverride', value.allowExecutionOptionsOverride)
    if (value.modelIds !== undefined) checkModelIds(errors, value.modelIds)
    if (errors.length > 0) throw new InvalidParams('agents.create', errors)

    const body: Body = {
        name: value.name,
        scope: value.scope ?? 'private',
        allow_execution_options_override: value.allowExecutionOptionsOverride ?? false,
    }
    if (value.description !== undefined) body.description = value.description
    if (value.instructions !== undefined) body.instructions = value.instructions
    if (capabilities !== undefined) body.capabilities = capabilities
    if (value.modelIds !== undefined) body.model_ids = [...(value.modelIds as string[])]
    return body
}

/** Validate `agents.update` arguments and build the body of `PUT /agents/{id}`. */
export function buildUpdateAgentBody(params: UpdateAgentParams): Body {
    const value = (params ?? {}) as unknown as Record<string, unknown>
    const errors: InvalidParam[] = []
    checkKeys(errors, value, UPDATE_KEYS)
    const body: Body = {}

    if (value.name !== undefined) {
        checkName(errors, value.name, false)
        body.name = value.name
    }
    for (const [param, max] of [
        ['description', AGENT_DESCRIPTION_MAX_LENGTH],
        ['instructions', AGENT_INSTRUCTIONS_MAX_LENGTH],
    ] as const) {
        if (value[param] === undefined) continue
        checkText(errors, param, value[param], max, true)
        body[param] = value[param]
    }
    if (value.scope !== undefined) {
        if (value.scope === null) errors.push(notNullable('scope'))
        else checkScope(errors, 'scope', value.scope)
        body.scope = value.scope
    }
    if (value.capabilities === null) {
        body.capabilities = null
    } else if (value.capabilities !== undefined) {
        body.capabilities = buildCapabilities(errors, 'capabilities', value.capabilities)
    }
    if (value.allowExecutionOptionsOverride !== undefined) {
        if (value.allowExecutionOptionsOverride === null) {
            errors.push(notNullable('allowExecutionOptionsOverride'))
        } else {
            checkBoolean(
                errors,
                'allowExecutionOptionsOverride',
                value.allowExecutionOptionsOverride,
            )
        }
        body.allow_execution_options_override = value.allowExecutionOptionsOverride
    }

    if (Object.keys(body).length === 0 && errors.length === 0) {
        errors.push({
            param: 'params',
            message:
                'at least one of name, description, instructions, scope, capabilities or ' +
                'allowExecutionOptionsOverride is required',
        })
    }
    if (errors.length > 0) throw new InvalidParams('agents.update', errors)
    return body
}

/** Validate `agents.setModels` arguments and build the body of `PUT /agents/{id}/models`. */
export function buildSetModelsBody(params: SetAgentModelsParams): Body {
    const errors: InvalidParam[] = []
    checkModelIds(errors, params?.modelIds)
    if (errors.length > 0) throw new InvalidParams('agents.setModels', errors)
    return { model_ids: [...params.modelIds] }
}

/** Read an agent from the wire: its `capabilities` become camelCase. */
export function readAgent<T extends AgentSummary>(raw: unknown): T {
    if (!isObject(raw)) return raw as T
    return { ...raw, capabilities: parseCapabilities(raw.capabilities) } as T
}

function checkName(errors: InvalidParam[], value: unknown, required: boolean): void {
    if (typeof value !== 'string') {
        errors.push({
            param: 'name',
            message:
                value === null
                    ? 'cannot be null: leave it out to keep the current name'
                    : required
                      ? 'required, must be a string'
                      : 'must be a string',
            input: value,
        })
    } else if (value === '') {
        errors.push({ param: 'name', message: 'must not be empty', input: value })
    }
}

function checkText(
    errors: InvalidParam[],
    param: string,
    value: unknown,
    max: number,
    nullable: boolean,
): void {
    if (value === undefined || (nullable && value === null)) return
    if (typeof value !== 'string') {
        errors.push({
            param,
            message: nullable ? 'must be a string, or null to clear it' : 'must be a string',
        })
        return
    }
    const length = characterCount(value)
    if (length > max) {
        errors.push({ param, message: `must be at most ${max} characters, got ${length}` })
    }
}

function checkBoolean(errors: InvalidParam[], param: string, value: unknown): void {
    if (value !== undefined && typeof value !== 'boolean') {
        errors.push({ param, message: 'must be true or false', input: value })
    }
}

function checkModelIds(errors: InvalidParam[], value: unknown): void {
    if (!Array.isArray(value)) {
        errors.push({
            param: 'modelIds',
            message: 'required, must be a non-empty array of model ids',
            input: value,
        })
    } else if (value.length === 0) {
        errors.push({
            param: 'modelIds',
            message: 'must not be empty: an agent needs at least one model',
        })
    } else {
        value.forEach((id, i) => {
            if (typeof id !== 'string' || id === '') {
                errors.push({
                    param: `modelIds[${i}]`,
                    message: 'must be a non-empty string',
                    input: id,
                })
            }
        })
    }
}

function notNullable(param: string): InvalidParam {
    return { param, message: 'cannot be null: leave it out to keep the current value' }
}
