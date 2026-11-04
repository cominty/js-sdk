/**
 * Upload a skill folder and attach it to an agent.
 *
 *   node examples/11-skills.ts ./my-skill
 *
 * The folder needs a SKILL.md at its root. Without one, a small skill is built
 * in memory instead.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { SkillFiles } from '../src/index.ts'
import { makeClient } from './_shared.ts'

const DEMO: SkillFiles = {
    'SKILL.md': [
        '---',
        'name: haiku-replies',
        'description: Answer every question as a haiku.',
        '---',
        '',
        'Always reply with a single haiku: three lines of 5, 7 and 5 syllables.',
        '',
    ].join('\n'),
}

/** Every file under `dir`, by path relative to it. The SDK leaves out dot entries. */
async function skillFiles(dir: string): Promise<SkillFiles> {
    const files: SkillFiles = {}
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const path = join(entry.parentPath, entry.name)
        files[relative(dir, path).split('\\').join('/')] = await readFile(path)
    }
    return files
}

await using client = makeClient()
const files = process.argv[2] ? await skillFiles(process.argv[2]) : DEMO

const skill = await client.skills.create(files, { displayName: 'SDK example skill' })
console.log(`uploaded ${skill.id}: ${skill.frontmatter.name} (${skill.source})`)

try {
    const agent = await client.agents.create({
        name: 'SDK example: with a skill',
        capabilities: { skills: { activation: 'always', include: [skill.id] } },
    })
    try {
        const run = await client.chat.start({ agentId: agent.id, message: 'What is Cominty?' })
        console.log(`\n${await run.text()}`)
    } finally {
        await client.agents.delete(agent.id)
    }

    const off = await client.skills.update(skill.id, { active: false })
    console.log(`\nactive: ${off.active}`)
} finally {
    await client.skills.delete(skill.id)
    console.log('deleted')
}
