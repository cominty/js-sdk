/**
 * The presigned upload every file-taking resource shares: ask the API for an
 * upload permission, send the bytes straight to the storage backend (which never
 * sees the API key), then confirm the upload with the `ETag` it answered.
 */

import { readUploadPermission, type PreparedUpload } from './models/files.ts'
import type { Transport } from './transport.ts'

export interface PresignedPaths {
    /** `GET` here (with `filename` and `mimetype`) returns the presigned POST. */
    permission: string
    /** `POST` here (with `etag` and `key`) confirms the upload and returns the file. */
    confirm: string
}

export async function presignedUpload<T>(
    transport: Transport,
    upload: PreparedUpload,
    paths: PresignedPaths,
    signal: AbortSignal | undefined,
): Promise<T> {
    const permission = readUploadPermission(
        await transport.request<unknown>('GET', paths.permission, {
            params: { filename: upload.filename, mimetype: upload.mimetype },
            signal,
        }),
        paths.permission,
    )
    // The presigned fields first: S3 ignores any field after the file.
    const form = new FormData()
    for (const [name, value] of Object.entries(permission.fields)) form.append(name, value)
    form.append('file', upload.blob, upload.filename)
    const etag = await transport.uploadToPresignedUrl(permission.url, form, signal)

    return transport.request<T>('POST', paths.confirm, {
        json: { etag, key: permission.key },
        signal,
    })
}
