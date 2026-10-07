/**
 * Request and response types for the memory resource.
 *
 * A memory file is identified by its namespace and its path. A namespace is a
 * name the caller chooses, shared by the whole organization; nothing creates
 * one — the first file in it does.
 *
 * Requests are validated before anything is sent, as in the chat models. The
 * size limits on `purpose` and `content` are left to the API.
 */

import { InvalidParams, type InvalidParam } from '../errors.ts'

/** Max namespace length, enforced server-side. */
export const NAMESPACE_MAX_LENGTH = 128

// ── Responses ─────────────────────────────────────────────────────────────── //

/** A memory file as `memory.list` returns it: everything but the content. */
export interface MemoryFileSummary {
    path: string
    /** The namespace the file is in, exactly as the caller named it. */
    namespace: string
    /** Why the file exists. The agent reads it. */
    purpose: string
    created_at: string
    updated_at: string
    /** Opaque token for the next `memory.update`. Pass it back unchanged. */
    version: string
    [key: string]: unknown
}

export interface MemoryFile extends MemoryFileSummary {
    /** The file's body. May be empty. */
    content: string
}

// ── Request params ────────────────────────────────────────────────────────── //

export interface ListMemoryFilesParams {
    /** Keep one namespace. Leave it out to list every file the API key can see. */
    namespace?: string
    signal?: AbortSignal
}

export interface CreateMemoryFileParams {
    /** At most one folder deep: `tone.md` or `preferences/tone.md`. */
    path: string
    /** The namespace the file goes in. Max 128 characters. */
    namespace: string
    /** Why the file exists. The agent reads it. */
    purpose: string
    /** The file's body. May be empty. */
    content: string
    signal?: AbortSignal
}

export interface UpdateMemoryFileParams {
    namespace: string
    /** The `version` from your last read of the file, unchanged. */
    version: string
    /** New body. Leave it out to keep the stored one. */
    content?: string
    /** New purpose. Leave it out to keep the stored one. */
    purpose?: string
    signal?: AbortSignal
}

// ── Validation + wire mapping ─────────────────────────────────────────────── //

/**
 * Check an optional namespace, under the name the caller passed it by.
 *
 * Shared with `chat.start`, whose `memoryNamespace` follows the same rule. The
 * value is never trimmed: an empty or padded name goes to the API as given.
 */
export function checkNamespace(errors: InvalidParam[], param: string, value: unknown): void {
    if (value === undefined) return
    if (typeof value !== 'string') {
        errors.push({ param, message: 'must be a string', input: value })
        return
    }
    const length = characterCount(value)
    if (length > NAMESPACE_MAX_LENGTH) {
        errors.push({
            param,
            message: `must be at most ${NAMESPACE_MAX_LENGTH} characters, got ${length}`,
        })
    }
}

/** Validate `memory.list` arguments and build the query of `GET /memory`. */
export function buildListQuery(params: ListMemoryFilesParams): { namespace?: string } {
    const errors: InvalidParam[] = []
    checkNamespace(errors, 'namespace', params.namespace)
    if (errors.length > 0) throw new InvalidParams('memory.list', errors)
    return { namespace: params.namespace }
}

/** Validate `memory.create` arguments and build the body of `POST /memory`. */
export function buildCreateBody(params: CreateMemoryFileParams): {
    path: string
    namespace: string
    purpose: string
    content: string
} {
    // `?? {}`: from plain JavaScript the whole argument can be missing.
    const { path, namespace, purpose, content } = params ?? {}
    const errors: InvalidParam[] = []
    checkPath(errors, path)
    requireNamespace(errors, namespace)
    // Neither is echoed back in the error: a file's body can be a megabyte.
    if (typeof purpose !== 'string') {
        errors.push({ param: 'purpose', message: 'required, must be a string' })
    }
    if (typeof content !== 'string') {
        errors.push({ param: 'content', message: 'required, must be a string' })
    }
    if (errors.length > 0) throw new InvalidParams('memory.create', errors)
    return { path, namespace, purpose, content }
}

/** Validate the `path` and `namespace` that name one file: the query of `/memory/file`. */
export function buildFileQuery(
    path: string,
    options: { namespace: string },
    context: string,
): { path: string; namespace: string } {
    const { namespace } = options ?? {}
    const errors: InvalidParam[] = []
    checkPath(errors, path)
    requireNamespace(errors, namespace)
    if (errors.length > 0) throw new InvalidParams(context, errors)
    return { path, namespace }
}

/**
 * Validate `memory.update` arguments and split them into the query that names
 * the file and the body that changes it.
 */
export function buildUpdate(
    path: string,
    params: UpdateMemoryFileParams,
): {
    query: { path: string; namespace: string; version: string }
    body: { content?: string; purpose?: string }
} {
    const { namespace, version, content, purpose } = params ?? {}
    const errors: InvalidParam[] = []
    checkPath(errors, path)
    requireNamespace(errors, namespace)
    // Opaque: only its presence is checked. A malformed one is the API's 422.
    if (typeof version !== 'string') {
        errors.push({
            param: 'version',
            message: 'required, must be the string from your last read of the file',
        })
    }
    if (content === undefined && purpose === undefined) {
        errors.push({ param: 'content or purpose', message: 'at least one is required' })
    }
    checkChange(errors, 'content', content)
    checkChange(errors, 'purpose', purpose)
    if (errors.length > 0) throw new InvalidParams('memory.update', errors)

    // Only the fields being changed: the API leaves the others as they are.
    const body: { content?: string; purpose?: string } = {}
    if (content !== undefined) body.content = content
    if (purpose !== undefined) body.purpose = purpose
    return { query: { path, namespace, version }, body }
}

function requireNamespace(errors: InvalidParam[], value: unknown): void {
    if (typeof value !== 'string') {
        errors.push({ param: 'namespace', message: 'required, must be a string', input: value })
    } else {
        checkNamespace(errors, 'namespace', value)
    }
}

function checkPath(errors: InvalidParam[], value: unknown): void {
    if (typeof value !== 'string') {
        errors.push({ param: 'path', message: 'required, must be a string', input: value })
    } else if (value.split('/').length - 1 > 1) {
        // The API would answer 422 "Maximum folder depth is 1".
        errors.push({
            param: 'path',
            message: "must be at most one folder deep, like 'folder/file.md'",
            input: value,
        })
    }
}

/** A field of `memory.update`: left out, or a string. */
function checkChange(errors: InvalidParam[], param: string, value: unknown): void {
    if (value === undefined || typeof value === 'string') return
    errors.push({
        param,
        // The API accepts a null, ignores it and still answers 200.
        message:
            value === null
                ? 'cannot be null: the API would ignore it and change nothing. A field ' +
                  'cannot be cleared; leave it out to keep it as it is'
                : 'must be a string',
    })
}

/** Length in characters as the API counts them: an emoji is one, not two. */
function characterCount(value: string): number {
    let count = 0
    for (const _ of value) count++
    return count
}
