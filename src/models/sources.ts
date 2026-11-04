/**
 * Request and response types for the sources resource.
 *
 * A source is a set of documents an agent can search. A drag-and-drop source is
 * built from files uploaded into a drive behind it; the SDK keeps the drive out
 * of sight and exposes the files through the source instead.
 */

import { InvalidParams, type InvalidParam } from '../errors.ts'
import type { Scope } from './common.ts'
import { collectUpload, type PreparedUpload, type UploadSource } from './files.ts'

/** Max files in one source (`MAX_COMINTY_FILES_PER_DRIVE`). */
export const SOURCE_MAX_FILES = 50

// ── Responses ─────────────────────────────────────────────────────────────── //

export type SourceStatus =
    | 'pending'
    | 'syncing'
    | 'synced'
    | 'error'
    | 'out_of_sync'
    | 'cancelling'
    | 'pausing'
    | 'paused'
    | 'archived'
    | 'disconnected'
    | 'inoperative_connection'
    | 'expired_connection'
    | 'invalid_configuration'
    | 'daily_quota_reached'

/** Where a source's documents live. API keys can only create `draganddrop` ones. */
export type SourceStore = 'draganddrop' | 'googledrive' | 'sharepoint'

export interface Source {
    /** Numeric id: the one `indexedDocuments.sourceIds` takes. */
    id: number
    /** Public id: the one every `client.sources` method takes. */
    pid: string
    created_at: string
    name: string
    scope: Scope
    created_by: string
    store: SourceStore
    status: SourceStatus
    size: number
    embedded_size: number
    /**
     * Store configuration as the API returns it: `{ meta: {...}, values: {...} }`,
     * where `values.drive_id` names the drive behind a drag-and-drop source.
     */
    config: Record<string, unknown>
    documents_synced: number
    documents_failed: number
    oversized_documents: number
    documents_embedded: number
    last_synced_at: string | null
    archived_at: string | null
    [key: string]: unknown
}

/** A file a drag-and-drop source is built from. */
export interface SourceFile {
    id: string
    created_at: string
    updated_at: string
    name: string
    size: number
    mimetype: string
    [key: string]: unknown
}

/** The drive behind a drag-and-drop source. Internal: never handed to callers. */
export interface Drive {
    id: string
    files: SourceFile[]
}

// ── Request params ────────────────────────────────────────────────────────── //

/** A file with its name: what `sources.create` and `sources.addFiles` take. */
export interface NamedFile {
    /** 1 to 255 characters, without `/`. Unique within the source. */
    filename: string
    content: UploadSource
    /** Left out: the `Blob`'s own type, then a guess from the name. */
    mimetype?: string
}

/** A `File` (its `name` is used), or any content with an explicit `filename`. */
export type SourceFileInput = File | NamedFile

export interface CreateSourceParams {
    /** Source name shown in the console. Left out, the server picks one. */
    name?: string
    signal?: AbortSignal
}

export interface UpdateSourceParams {
    /** New name. The only field of a drag-and-drop source that can change. */
    name: string
    signal?: AbortSignal
}

export interface WaitSyncedParams {
    /** Milliseconds to wait at most. Default 600 000 (10 minutes). */
    timeout?: number
    /** Milliseconds between two reads. Default 5 000. */
    interval?: number
    signal?: AbortSignal
}

// ── Validation ────────────────────────────────────────────────────────────── //

/**
 * Validate the files of `sources.create` or `sources.addFiles`, naming every
 * problem at once. `existing` counts the files already in the source, for the
 * 50-file cap. No content is ever echoed in an error.
 */
export function prepareSourceFiles(
    files: unknown,
    context: string,
    existing = 0,
): PreparedUpload[] {
    const errors: InvalidParam[] = []
    const items = Array.isArray(files) ? files : files === undefined ? [] : [files]

    if (items.length === 0) {
        errors.push({ param: 'files', message: 'expected at least one file' })
    }
    const uploads: PreparedUpload[] = []
    const seen = new Map<string, number>()
    items.forEach((item, index) => {
        const at = Array.isArray(files) ? `files[${index}]` : 'files'
        const named = isNamedFile(item)
        const upload = collectUpload(
            errors,
            {
                file: named ? `${at}.content` : at,
                filename: `${at}.filename`,
                mimetype: `${at}.mimetype`,
            },
            named ? item.content : item,
            named ? item.filename : undefined,
            named ? item.mimetype : undefined,
        )
        if (upload === undefined) return
        const first = seen.get(upload.filename)
        if (first !== undefined) {
            errors.push({
                param: `${at}.filename`,
                message: `files[${first}] has the same name: file names must be unique within a source`,
                input: upload.filename,
            })
        }
        seen.set(upload.filename, index)
        uploads.push(upload)
    })

    const total = existing + items.length
    if (total > SOURCE_MAX_FILES) {
        errors.push({
            param: 'files',
            message: `a source holds at most ${SOURCE_MAX_FILES} files, this would make ${total}`,
        })
    }
    if (errors.length > 0) throw new InvalidParams(context, errors)
    return uploads
}

/** Validate `sources.create` options and build the body of `POST /dc/sources`. */
export function buildCreateSourceBody(
    params: Omit<CreateSourceParams, 'signal'>,
    driveId: string,
): Record<string, unknown> {
    // API keys may only create private drag-and-drop sources: neither is a choice.
    const body: Record<string, unknown> = {
        store: 'draganddrop',
        scope: 'private',
        config: { drive_id: driveId },
    }
    if (params.name !== undefined) body.name = params.name
    return body
}

/** Check the `name` of `sources.create`, before any upload. */
export function checkSourceName(name: unknown, context: string, required: boolean): void {
    if (name === undefined && !required) return
    if (typeof name !== 'string') {
        throw new InvalidParams(context, [
            {
                param: 'name',
                message: required ? 'required, must be a string' : 'must be a string',
                input: name,
            },
        ])
    }
}

/** The drive behind a drag-and-drop source, or `null` for a connected store. */
export function sourceDriveId(source: Source): string | null {
    // The API nests the stored values under "values"; accept a flat object too.
    const config = source.config ?? {}
    const values = 'values' in config ? config.values : config
    if (typeof values !== 'object' || values === null) return null
    const driveId = (values as Record<string, unknown>).drive_id
    return typeof driveId === 'string' && driveId !== '' ? driveId : null
}

function isNamedFile(value: unknown): value is NamedFile {
    return (
        typeof value === 'object' &&
        value !== null &&
        !(value instanceof Blob) &&
        !(value instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(value) &&
        'content' in value
    )
}
