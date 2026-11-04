/** Types and checks shared by the agents, skills and sources resources. */

import { InvalidParams, type InvalidParam } from '../errors.ts'

/** Who sees a resource: its creator only, or every member of the organization. */
export type Scope = 'private' | 'organization'

const SCOPES: readonly Scope[] = ['private', 'organization']

/** Check an optional {@link Scope}. */
export function checkScope(errors: InvalidParam[], param: string, value: unknown): void {
    if (value === undefined) return
    if (!SCOPES.includes(value as Scope)) {
        errors.push({ param, message: "must be 'private' or 'organization'", input: value })
    }
}

/**
 * Check the id that goes in a URL path and return it encoded. Throws
 * `InvalidParams` straight away: an empty id would hit another endpoint.
 */
export function pathId(value: unknown, param: string, context: string): string {
    if (typeof value !== 'string' || value === '') {
        throw new InvalidParams(context, [
            { param, message: 'required, must be a non-empty string', input: value },
        ])
    }
    return encodeURIComponent(value)
}

/** Refuse keys outside `allowed`, pointing a snake_case one to its camelCase name. */
export function checkKeys(
    errors: InvalidParam[],
    value: Record<string, unknown>,
    allowed: readonly string[],
    prefix = '',
): void {
    for (const key of Object.keys(value)) {
        if (allowed.includes(key)) continue
        const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
        errors.push({
            param: `${prefix}${key}`,
            message: allowed.includes(camel)
                ? `unknown key: arguments are camelCase, use '${camel}'`
                : `unknown key, expected one of ${allowed.join(', ')}`,
        })
    }
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
