/**
 * Request and response types for the skills resource.
 *
 * A skill is a folder whose `SKILL.md` opens with YAML frontmatter (`name`,
 * `description`, and optionally `license`, `compatibility`, `metadata`,
 * `allowed-tools`, per https://agentskills.io/specification), plus any
 * supporting files. It is uploaded as a zip archive.
 */

import { InvalidParams, type InvalidParam } from '../errors.ts'
import { zip, type ZipEntry } from '../zip.ts'
import { checkKeys, checkScope, isObject, type Scope } from './common.ts'
import { toBlob, typeName, type UploadSource } from './files.ts'
import { characterCount } from './memory.ts'

/** Max archive size (`MAX_SKILL_ZIP_SIZE`, 30 MB). */
export const SKILL_MAX_BYTES = 30 * 1024 * 1024
/** Max display name length (`DISPLAY_NAME_MAX_LENGTH`). */
export const SKILL_DISPLAY_NAME_MAX_LENGTH = 100

const SKILL_MD = 'SKILL.md'
const ZIP_MIMETYPE = 'application/zip'

// ── Responses ─────────────────────────────────────────────────────────────── //

/** `cominty`: built in, shared by every organization, read-only. `custom`: uploaded. */
export type SkillSource = 'cominty' | 'custom'

/** The YAML frontmatter of the skill's `SKILL.md`, parsed by the server. */
export interface SkillFrontmatter {
    name: string
    description: string
    license: string | null
    compatibility: string | null
    metadata: Record<string, string>
    allowed_tools: string[]
    [key: string]: unknown
}

export interface Skill {
    /** The id `skills.include` takes. */
    id: string
    created_at: string
    /** When the default version was last uploaded. */
    updated_at: string
    display_name: string
    active: boolean
    /** `null` for built-in skills. */
    scope: Scope | null
    source: SkillSource
    frontmatter: SkillFrontmatter
    [key: string]: unknown
}

// ── Request params ────────────────────────────────────────────────────────── //

/**
 * A skill's files by path inside the skill folder, `SKILL.md` at the root:
 * `{ 'SKILL.md': '---\nname: …', 'scripts/run.py': bytes }`. A string is
 * written as UTF-8. Entries with a path part starting with `.` are left out.
 */
export type SkillFiles = Record<string, string | UploadSource>

/** A zip archive as it is (`Blob`, `ArrayBuffer`, `Uint8Array`), or files to zip. */
export type SkillArchive = UploadSource | SkillFiles

export interface CreateSkillParams {
    /** Name shown in the console, 1 to 100 characters. */
    displayName: string
    /** `'private'` (default) or `'organization'`. */
    scope?: Scope
    signal?: AbortSignal
}

/** A partial update: only the fields you pass are sent, and at least one is needed. */
export interface UpdateSkillParams {
    displayName?: string
    /** Whether agents may use the skill. */
    active?: boolean
    scope?: Scope
    signal?: AbortSignal
}

// ── Validation + wire mapping ─────────────────────────────────────────────── //

/** A validated archive, ready to send as the multipart `file` part. */
export interface PreparedArchive {
    blob: Blob
    filename: string
}

/** Validate `skills.create` options and build its multipart fields. */
export function buildCreateSkillFields(params: CreateSkillParams): Record<string, string> {
    const value = (params ?? {}) as unknown as Record<string, unknown>
    const errors: InvalidParam[] = []
    checkKeys(errors, value, ['displayName', 'scope', 'signal'])
    checkDisplayName(errors, value.displayName, true)
    checkScope(errors, 'scope', value.scope)
    if (errors.length > 0) throw new InvalidParams('skills.create', errors)
    return {
        display_name: value.displayName as string,
        scope: (value.scope as Scope | undefined) ?? 'private',
    }
}

/** Validate `skills.update` arguments and build the body of `PUT /skills/{id}`. */
export function buildUpdateSkillBody(params: UpdateSkillParams): Record<string, unknown> {
    const value = (params ?? {}) as unknown as Record<string, unknown>
    const errors: InvalidParam[] = []
    checkKeys(errors, value, ['displayName', 'active', 'scope', 'signal'])
    const body: Record<string, unknown> = {}
    if (value.displayName !== undefined) {
        checkDisplayName(errors, value.displayName, false)
        body.display_name = value.displayName
    }
    if (value.active !== undefined) {
        if (typeof value.active !== 'boolean') {
            errors.push({ param: 'active', message: 'must be true or false', input: value.active })
        }
        body.active = value.active
    }
    if (value.scope !== undefined) {
        checkScope(errors, 'scope', value.scope)
        body.scope = value.scope
    }
    if (Object.keys(body).length === 0 && errors.length === 0) {
        errors.push({
            param: 'params',
            message: 'at least one of displayName, active or scope is required',
        })
    }
    if (errors.length > 0) throw new InvalidParams('skills.update', errors)
    return body
}

/**
 * Validate the archive of `skills.create` or `skills.uploadVersion` and return
 * it ready to send: a zip as it is, or the zip of a {@link SkillFiles} map.
 * Nothing is echoed in an error: a skill file may hold a secret.
 */
export async function prepareArchive(file: unknown, context: string): Promise<PreparedArchive> {
    const blob = toBlob(file)
    if (blob !== undefined) {
        checkSize(blob.size, context)
        const name = (file as { name?: unknown }).name
        const filename = typeof name === 'string' && name !== '' ? name : 'skill.zip'
        return { blob: relabel(blob), filename }
    }
    if (!isObject(file)) {
        const hint =
            typeof file === 'string'
                ? ": a string is ambiguous between a path and content. Pass the zip's bytes, " +
                  "or the skill's files as { 'SKILL.md': '...' }"
                : ''
        throw invalid(
            context,
            `must be a zip (Blob, ArrayBuffer or Uint8Array) or an object of files, got ${typeName(file)}${hint}`,
        )
    }

    const errors: InvalidParam[] = []
    const entries: ZipEntry[] = []
    const encoder = new TextEncoder()
    for (const [path, content] of Object.entries(file).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const param = `file['${path}']`
        const parts = path.split('/')
        if (
            path === '' ||
            path.startsWith('/') ||
            path.includes('\\') ||
            parts.some((p) => p === '' || p === '..' || p === '.')
        ) {
            errors.push({
                param,
                message: "must be a relative path like 'SKILL.md' or 'scripts/run.py'",
            })
            continue
        }
        // Hidden files and folders stay out, as when zipping a folder on disk.
        if (parts.some((part) => part.startsWith('.'))) continue
        const data =
            typeof content === 'string' ? encoder.encode(content) : await bytesOf(toBlob(content))
        if (data === undefined) {
            errors.push({
                param,
                message: `must be a string, Blob, ArrayBuffer or Uint8Array, got ${typeName(content)}`,
            })
            continue
        }
        entries.push({ name: path, data })
    }
    if (!entries.some((entry) => entry.name === SKILL_MD) && errors.length === 0) {
        errors.push({ param: 'file', message: `has no '${SKILL_MD}' at its root` })
    }
    if (errors.length > 0) throw new InvalidParams(context, errors)

    const archive = zip(entries)
    checkSize(archive.length, context)
    return { blob: new Blob([archive as BlobPart], { type: ZIP_MIMETYPE }), filename: 'skill.zip' }
}

function checkDisplayName(errors: InvalidParam[], value: unknown, required: boolean): void {
    if (typeof value !== 'string') {
        errors.push({
            param: 'displayName',
            message: required ? 'required, must be a string' : 'must be a string',
            input: value,
        })
        return
    }
    const length = characterCount(value)
    if (length === 0 || length > SKILL_DISPLAY_NAME_MAX_LENGTH) {
        errors.push({
            param: 'displayName',
            message: `must be 1 to ${SKILL_DISPLAY_NAME_MAX_LENGTH} characters, got ${length}`,
            input: value,
        })
    }
}

function checkSize(size: number, context: string): void {
    if (size > SKILL_MAX_BYTES) {
        throw invalid(
            context,
            `is ${size} bytes, over the ${SKILL_MAX_BYTES} bytes (30 MB) the API accepts`,
        )
    }
}

function invalid(context: string, message: string): InvalidParams {
    return new InvalidParams(context, [{ param: 'file', message }])
}

/** The part is always sent as a zip, whatever the Blob says. */
function relabel(blob: Blob): Blob {
    return blob.type === ZIP_MIMETYPE ? blob : blob.slice(0, blob.size, ZIP_MIMETYPE)
}

async function bytesOf(blob: Blob | undefined): Promise<Uint8Array | undefined> {
    return blob === undefined ? undefined : new Uint8Array(await blob.arrayBuffer())
}
