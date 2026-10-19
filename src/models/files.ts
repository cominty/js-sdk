/**
 * Request types and validation for conversation files: `chat.uploadFile` and
 * `chat.downloadFile`.
 *
 * Only web-standard types are used, so uploads work the same in Node and in a
 * browser: a `Blob` (a `File` is one), an `ArrayBuffer`, or a view of one such as
 * a `Uint8Array` or a Node `Buffer`.
 */

import { InvalidParams, SDKError, type InvalidParam } from '../errors.ts'
import { characterCount } from './memory.ts'

/** Max upload size of the hosted API (`CONVERSATION_FILE_MAX_SIZE`, 500 MiB). */
export const UPLOAD_MAX_BYTES = 500 * 1024 * 1024
/** Max file name length, enforced server-side on `GET /chat/files/upload`. */
export const FILENAME_MAX_LENGTH = 255

const DEFAULT_MIMETYPE = 'application/octet-stream'

/** What `chat.uploadFile` accepts as the file's content. */
export type UploadSource = Blob | ArrayBuffer | ArrayBufferView

export interface UploadFileParams {
    /**
     * Name stored with the file, 1 to 255 characters without `/`. Optional for a
     * `File` (its `name` is used), required for anything else.
     */
    filename?: string
    /**
     * Content type. Left out, it is the `Blob`'s own `type`, then a guess from the
     * file name, then `application/octet-stream`.
     */
    mimetype?: string
    /** Abort the upload. */
    signal?: AbortSignal
}

/** A validated upload, ready to send. */
export interface PreparedUpload {
    blob: Blob
    filename: string
    mimetype: string
}

/**
 * Validate `chat.uploadFile` arguments, naming every problem at once.
 *
 * The file itself is never echoed in an error: it may be a whole document, or a
 * secret passed by mistake.
 */
export function prepareUpload(file: unknown, params: UploadFileParams): PreparedUpload {
    const { filename, mimetype } = params ?? {}
    const errors: InvalidParam[] = []

    const blob = toBlob(file)
    if (blob === undefined) {
        const hint =
            typeof file === 'string'
                ? ': a string is ambiguous between a path and text. In Node, upload a path ' +
                  'with await fs.openAsBlob(path)'
                : ''
        errors.push({
            param: 'file',
            message: `must be a Blob, File, ArrayBuffer or Uint8Array, got ${typeName(file)}${hint}`,
        })
    } else if (blob.size > UPLOAD_MAX_BYTES) {
        errors.push({
            param: 'file',
            message: `is ${blob.size} bytes, over the ${UPLOAD_MAX_BYTES} bytes (500 MiB) the API accepts`,
        })
    }

    const name = filename ?? fileName(file)
    if (name === undefined) {
        errors.push({ param: 'filename', message: 'required unless file is a File with a name' })
    } else if (typeof name !== 'string') {
        errors.push({ param: 'filename', message: 'must be a string', input: name })
    } else if (name === '') {
        errors.push({ param: 'filename', message: 'must not be empty', input: name })
    } else if (name.includes('/')) {
        errors.push({ param: 'filename', message: "must not contain '/'", input: name })
    } else if (characterCount(name) > FILENAME_MAX_LENGTH) {
        errors.push({
            param: 'filename',
            message: `must be at most ${FILENAME_MAX_LENGTH} characters, got ${characterCount(name)}`,
        })
    }

    if (mimetype !== undefined && (typeof mimetype !== 'string' || mimetype === '')) {
        errors.push({ param: 'mimetype', message: 'must be a non-empty string', input: mimetype })
    }

    if (errors.length > 0) throw new InvalidParams('chat.uploadFile', errors)

    const resolvedName = name as string
    const type = mimetype ?? (blob!.type || guessMimetype(resolvedName))
    // The part's content type is the Blob's: re-label it without copying the bytes.
    const labelled = blob!.type === type ? blob! : blob!.slice(0, blob!.size, type)
    return { blob: labelled, filename: resolvedName, mimetype: type }
}

/** The answer of `GET /chat/files/upload`: a presigned POST. */
export interface FileUploadPermission {
    url: string
    fields: Record<string, string>
}

/** Check the upload permission the API answered with. */
export function readUploadPermission(raw: unknown): FileUploadPermission & { key: string } {
    const value = raw as { url?: unknown; fields?: unknown } | null
    const fields = value?.fields as Record<string, unknown> | null | undefined
    if (
        typeof value?.url !== 'string' ||
        typeof fields !== 'object' ||
        fields === null ||
        typeof fields.key !== 'string'
    ) {
        // Not the raw answer: its fields hold the presigned signature.
        throw new SDKError(
            'GET /chat/files/upload did not answer with a presigned upload ' +
                '(expected a url and fields containing a key)',
        )
    }
    const strings: Record<string, string> = {}
    for (const [k, v] of Object.entries(fields)) strings[k] = String(v)
    return { url: value.url, fields: strings, key: fields.key }
}

/** Validate the id of `chat.downloadFile`. */
export function checkFileId(fileId: unknown): string {
    if (typeof fileId !== 'string' || fileId === '') {
        throw new InvalidParams('chat.downloadFile', [
            { param: 'fileId', message: 'required, must be a non-empty string', input: fileId },
        ])
    }
    return fileId
}

function toBlob(file: unknown): Blob | undefined {
    if (file instanceof Blob) return file
    if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
        return new Blob([file as BlobPart])
    }
    return undefined
}

function fileName(file: unknown): string | undefined {
    if (!(file instanceof Blob)) return undefined
    const name = (file as { name?: unknown }).name
    return typeof name === 'string' && name !== '' ? name : undefined
}

function typeName(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'object') return value.constructor?.name ?? 'object'
    return typeof value
}

/** The common types an agent reads. Anything else is `application/octet-stream`. */
const MIMETYPES: Record<string, string> = {
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    htm: 'text/html',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    md: 'text/markdown',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    odt: 'application/vnd.oasis.opendocument.text',
    pdf: 'application/pdf',
    png: 'image/png',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    svg: 'image/svg+xml',
    tsv: 'text/tab-separated-values',
    txt: 'text/plain',
    wav: 'audio/wav',
    webp: 'image/webp',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    zip: 'application/zip',
}

function guessMimetype(filename: string): string {
    const dot = filename.lastIndexOf('.')
    if (dot < 0) return DEFAULT_MIMETYPE
    return MIMETYPES[filename.slice(dot + 1).toLowerCase()] ?? DEFAULT_MIMETYPE
}
