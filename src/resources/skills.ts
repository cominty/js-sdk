/** The skills resource: upload the skills an agent can load. */

import { pathId } from '../models/common.ts'
import {
    buildCreateSkillFields,
    buildUpdateSkillBody,
    prepareArchive,
    type CreateSkillParams,
    type PreparedArchive,
    type Skill,
    type SkillArchive,
    type UpdateSkillParams,
} from '../models/skills.ts'
import type { Transport } from '../transport.ts'

interface Options {
    signal?: AbortSignal
}

export class SkillsResource {
    readonly #transport: Transport

    // No `userId`: skills belong to the API key's organization, not to the end user.
    constructor(transport: Transport) {
        this.#transport = transport
    }

    /**
     * List the skills this API key can give to an agent: the built-in Cominty
     * skills (`source: 'cominty'`), the organization's custom skills, and the
     * ones owned by the key's creator. Pass a skill's `id` in `skills.include`.
     */
    async list(options: Options = {}): Promise<Skill[]> {
        return this.#transport.request<Skill[]>('GET', '/skills', { signal: options.signal })
    }

    /**
     * Upload a new custom skill.
     *
     * `file` is a zip archive sent as it is, or the skill's files by path, which
     * are zipped in memory (`SKILL.md` at the root; entries starting with `.` are
     * left out). Over 30 MB throws `InvalidParams` before anything is sent. The
     * server parses the frontmatter: a bad one, or a bad archive layout, throws an
     * `APIError` (422) with the reason.
     *
     * ```ts
     * const skill = await client.skills.create(
     *     { 'SKILL.md': '---\nname: release-notes\ndescription: Drafts release notes\n---\n…' },
     *     { displayName: 'Release notes' },
     * )
     * ```
     */
    async create(file: SkillArchive, params: CreateSkillParams): Promise<Skill> {
        const fields = buildCreateSkillFields(params)
        const archive = await prepareArchive(file, 'skills.create')
        const form = new FormData()
        for (const [name, value] of Object.entries(fields)) form.append(name, value)
        appendArchive(form, archive)
        return this.#transport.request<Skill>('POST', '/skills', { form, signal: params.signal })
    }

    /** Rename, turn on or off, or re-scope a custom skill. Only the fields you pass are sent. */
    async update(skillId: string, params: UpdateSkillParams): Promise<Skill> {
        const id = pathId(skillId, 'skillId', 'skills.update')
        const body = buildUpdateSkillBody(params)
        return this.#transport.request<Skill>('PUT', `/skills/${id}`, {
            json: body,
            signal: params.signal,
        })
    }

    /**
     * Upload a new version of a custom skill and make it the default. Takes the
     * same `file` shapes as {@link create}.
     *
     * Versions are tagged to the second: two uploads of the same skill within one
     * second collide (500), so space them out.
     */
    async uploadVersion(
        skillId: string,
        file: SkillArchive,
        options: Options = {},
    ): Promise<Skill> {
        const id = pathId(skillId, 'skillId', 'skills.uploadVersion')
        const archive = await prepareArchive(file, 'skills.uploadVersion')
        const form = new FormData()
        appendArchive(form, archive)
        return this.#transport.request<Skill>('POST', `/skills/${id}/versions`, {
            form,
            signal: options.signal,
        })
    }

    /** Delete a custom skill and every version of it. This is permanent. */
    async delete(skillId: string, options: Options = {}): Promise<void> {
        const id = pathId(skillId, 'skillId', 'skills.delete')
        await this.#transport.request<unknown>('DELETE', `/skills/${id}`, {
            signal: options.signal,
        })
    }
}

function appendArchive(form: FormData, archive: PreparedArchive): void {
    form.append('file', archive.blob, archive.filename)
}
