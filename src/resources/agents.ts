/** The agents resource: list the agents a key can use, and manage custom ones. */

import {
    buildCreateAgentBody,
    buildSetModelsBody,
    buildUpdateAgentBody,
    readAgent,
    type AgentDetail,
    type AgentSummary,
    type CreateAgentParams,
    type LlmModel,
    type SetAgentModelsParams,
    type UpdateAgentParams,
} from '../models/agents.ts'
import { pathId } from '../models/common.ts'
import type { Transport } from '../transport.ts'

interface Options {
    signal?: AbortSignal
}

export class AgentsResource {
    readonly #transport: Transport

    // No `userId`: agents belong to the API key's organization, not to the end user.
    constructor(transport: Transport) {
        this.#transport = transport
    }

    /**
     * List the agents this API key can use: the built-in Cominty agents
     * (`managed: true`), the organization's, and the ones owned by the key's
     * creator. Summaries only, without `instructions` or `models`.
     */
    async list(options: Options = {}): Promise<AgentSummary[]> {
        const raw = await this.#transport.request<unknown[]>('GET', '/agents', {
            signal: options.signal,
        })
        return raw.map((agent) => readAgent<AgentSummary>(agent))
    }

    /** List the language models a custom agent can run on, for `modelIds`. */
    async listModels(options: Options = {}): Promise<LlmModel[]> {
        return this.#transport.request<LlmModel[]>('GET', '/agents/models', {
            signal: options.signal,
        })
    }

    /** Fetch one agent, with its instructions and model chain. */
    async get(agentId: string, options: Options = {}): Promise<AgentDetail> {
        const id = pathId(agentId, 'agentId', 'agents.get')
        return readAgent<AgentDetail>(
            await this.#transport.request<unknown>('GET', `/agents/${id}`, {
                signal: options.signal,
            }),
        )
    }

    /**
     * Create a custom agent, owned by the admin who minted the API key (`owner`)
     * and living in the key's organization.
     *
     * ```ts
     * const agent = await client.agents.create({
     *     name: 'Support',
     *     instructions: 'Answer from the docs. Be brief.',
     *     capabilities: { web: { activation: 'never' } },
     * })
     * ```
     */
    async create(params: CreateAgentParams): Promise<AgentDetail> {
        const body = buildCreateAgentBody(params)
        return readAgent<AgentDetail>(
            await this.#transport.request<unknown>('POST', '/agents', {
                json: body,
                signal: params.signal,
            }),
        )
    }

    /**
     * Change some fields of a custom agent.
     *
     * Partial: only the fields you pass are sent. `null` clears `description`,
     * `instructions` or `capabilities`. A `capabilities` object is merged key by
     * key: each capability you pass replaces the stored one, the others stay. A
     * built-in agent throws `NotFoundError`.
     */
    async update(agentId: string, params: UpdateAgentParams): Promise<AgentDetail> {
        const id = pathId(agentId, 'agentId', 'agents.update')
        const body = buildUpdateAgentBody(params)
        return readAgent<AgentDetail>(
            await this.#transport.request<unknown>('PUT', `/agents/${id}`, {
                json: body,
                signal: params.signal,
            }),
        )
    }

    /**
     * Replace an agent's model chain. On a built-in (`managed`) agent, this sets
     * the organization's chain for that agent's tier instead. An unknown model id
     * throws `NotFoundError`.
     */
    async setModels(agentId: string, params: SetAgentModelsParams): Promise<AgentDetail> {
        const id = pathId(agentId, 'agentId', 'agents.setModels')
        const body = buildSetModelsBody(params)
        return readAgent<AgentDetail>(
            await this.#transport.request<unknown>('PUT', `/agents/${id}/models`, {
                json: body,
                signal: params.signal,
            }),
        )
    }

    /**
     * Delete a custom agent. This is permanent. Messages it handled keep working
     * and report their agent as `ARCHIVED`.
     */
    async delete(agentId: string, options: Options = {}): Promise<void> {
        const id = pathId(agentId, 'agentId', 'agents.delete')
        await this.#transport.request<unknown>('DELETE', `/agents/${id}`, {
            signal: options.signal,
        })
    }
}
