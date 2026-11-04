/** The documents resource: resolve a document an agent cited. */

import { InvalidParams } from '../errors.ts'
import type { SourceStore } from '../models/sources.ts'
import type { Transport } from '../transport.ts'

/** Where a document cited by an agent comes from. */
export interface DocumentMetadata {
    document_id: string
    /** The numeric id of its source, as `indexedDocuments.sourceIds` takes it. */
    source_id: number
    /** The public id of its source, as `client.sources` takes it. */
    source_pid: string
    source_type: SourceStore
    document_name: string
    document_uri: string | null
    document_extension: string
    document_mime_type: string
    [key: string]: unknown
}

export class DocumentsResource {
    readonly #transport: Transport

    constructor(transport: Transport) {
        this.#transport = transport
    }

    /**
     * Resolve a document id from an agent citation to its source and file.
     *
     * Sends `GET /documents?id=…`. The composite id may contain `#`: it is sent
     * URL-encoded. An id unknown to the key's organization throws `NotFoundError`.
     */
    async get(
        documentId: string,
        options: { signal?: AbortSignal } = {},
    ): Promise<DocumentMetadata> {
        if (typeof documentId !== 'string' || documentId === '') {
            throw new InvalidParams('documents.get', [
                {
                    param: 'documentId',
                    message: 'required, must be a non-empty string',
                    input: documentId,
                },
            ])
        }
        return this.#transport.request<DocumentMetadata>('GET', '/documents', {
            params: { id: documentId },
            signal: options.signal,
        })
    }
}
