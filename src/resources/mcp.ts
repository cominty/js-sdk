/** The MCP resource: the MCP integrations an agent can be given. */

import { InvalidParams, SDKError } from '../errors.ts'
import type { Transport } from '../transport.ts'

/** One MCP integration visible to this API key. */
export interface McpServer {
    /** Stable integration id: the value `mcp.connections` takes. */
    name: string
    /** Label to show. */
    title: string
    /** Short text to show. */
    description: string
    /** `true` when this caller has the integration turned on. */
    is_enabled: boolean
    /** Where the server comes from: `builtin` and `remote` today, others may appear. */
    origin: string
    /** Who the integration belongs to: `organization` or `user` today. */
    scope: string
    /** `true` when the user must connect OAuth before the server can be used. */
    requires_oauth_connect: boolean
    /** Present when known, for example `connected`. */
    connection_status?: string | null
    icon_uri?: string | null
    /** Remote server URL, when the server has one. */
    mcp_url?: string | null
    owner_id?: string | null
    created_at?: string | null
    updated_at?: string | null
    [key: string]: unknown
}

export interface ListMcpServersParams {
    /**
     * Which servers to keep, by `is_enabled`. `true` (the default) keeps the ones
     * turned on, `false` only the ones that are off, `null` every server in the
     * order the API sent them.
     */
    enabled?: boolean | null
    signal?: AbortSignal
}

export class McpResource {
    readonly #transport: Transport

    constructor(transport: Transport) {
        this.#transport = transport
    }

    /**
     * List the MCP integrations this API key can use.
     *
     * Sends `GET /mcp/manifest`, which returns every server, including the ones
     * not turned on: `enabled` filters that list here. A server's `name` is what
     * `mcp.connections` takes, in `threadCapabilities`, `messageScope` or an
     * agent's `capabilities`.
     *
     * ```ts
     * const servers = await client.mcp.list()
     * await client.agents.create({
     *     name: 'Linear helper',
     *     capabilities: { mcp: { activation: 'always', connections: servers.map((s) => s.name) } },
     * })
     * ```
     */
    async list(params: ListMcpServersParams = {}): Promise<McpServer[]> {
        const enabled = params?.enabled === undefined ? true : params.enabled
        if (enabled !== null && typeof enabled !== 'boolean') {
            throw new InvalidParams('mcp.list', [
                { param: 'enabled', message: 'must be true, false or null', input: enabled },
            ])
        }
        const raw = await this.#transport.request<{ servers?: unknown }>('GET', '/mcp/manifest', {
            signal: params?.signal,
        })
        const servers = raw?.servers
        if (!Array.isArray(servers)) {
            throw new SDKError('GET /mcp/manifest did not answer with a list of servers')
        }
        const all = servers as McpServer[]
        return enabled === null ? all : all.filter((server) => server.is_enabled === enabled)
    }
}
