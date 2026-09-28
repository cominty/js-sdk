/**
 * Resolved client configuration.
 *
 * Resolution order for every option: explicit argument → environment variable →
 * default. The SDK does not read `.env` files; export the vars or load the file
 * yourself.
 */

export const DEFAULT_BASE_URL = 'https://ds.cominty.com'
/** Milliseconds. The Python SDK's equivalent default is 60 seconds. */
export const DEFAULT_TIMEOUT_MS = 60_000

const TOKEN_ENV = 'COMINTY_API_KEY'
const USER_ID_ENV = 'COMINTY_USER_ID'
const BASE_URL_ENV = 'COMINTY_BASE_URL'

export interface ComintyOptions {
    /** Your API key. Falls back to `COMINTY_API_KEY`. */
    apiToken?: string
    /**
     * The end user every request acts on behalf of. Falls back to
     * `COMINTY_USER_ID`. Set once here and applied to every call, so resource
     * methods never take it.
     */
    userId?: string
    /** API base URL. Falls back to `COMINTY_BASE_URL`, then the public API. */
    baseUrl?: string
    /** Per-request timeout in **milliseconds**. Streams are exempt. */
    timeout?: number
    /** Inject a `fetch` implementation (tests, proxies, instrumentation). */
    fetch?: typeof globalThis.fetch
    /**
     * Allow construction in a browser. Off by default: an API key shipped to a
     * browser is readable by anyone who opens devtools. Call the API from your
     * own backend instead.
     */
    dangerouslyAllowBrowser?: boolean
}

export interface ResolvedConfig {
    apiToken: string
    userId: string
    baseUrl: string
    timeout: number
    fetch: typeof globalThis.fetch
}

function env(name: string): string | undefined {
    // `process` is absent in browsers and in some edge runtimes.
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    const value = proc?.env?.[name]
    return value === '' ? undefined : value
}

export function resolveConfig(options: ComintyOptions = {}): ResolvedConfig {
    if (
        typeof window !== 'undefined' &&
        typeof window.document !== 'undefined' &&
        !options.dangerouslyAllowBrowser
    ) {
        throw new Error(
            'Refusing to construct a Cominty client in a browser: your API key would be exposed ' +
                'to anyone who opens devtools. Call the API from your server instead. If this ' +
                'really is a trusted environment, pass `dangerouslyAllowBrowser: true`.',
        )
    }

    const apiToken = options.apiToken ?? env(TOKEN_ENV)
    if (!apiToken) {
        throw new Error(
            `apiToken is required: pass apiToken: '…' or set ${TOKEN_ENV} in the environment.`,
        )
    }

    const userId = options.userId ?? env(USER_ID_ENV)
    if (!userId) {
        throw new Error(
            `userId is required: pass userId: '…' or set ${USER_ID_ENV} in the environment. ` +
                'Find yours at platform.cominty.ai -> avatar (top right) -> Profile.',
        )
    }

    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
        throw new Error(
            'No global fetch available. Use Node 20+, or pass a `fetch` implementation.',
        )
    }

    return {
        apiToken,
        userId,
        baseUrl: (options.baseUrl ?? env(BASE_URL_ENV) ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
        timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
        // Unbind so a caller-supplied fetch isn't invoked with the wrong `this`.
        fetch: (...args) => fetchImpl(...args),
    }
}
