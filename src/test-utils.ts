/** Test-only helpers. Excluded from the published build. */

export interface RecordedCall {
    url: string
    method: string
    headers: Record<string, string>
    body: unknown
}

export interface MockFetch {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    calls: RecordedCall[]
}

/** A `fetch` that replays canned responses in order and records every call. */
export function mockFetch(responses: (Response | (() => Response))[]): MockFetch {
    let index = 0
    const calls: RecordedCall[] = []
    const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
            headers[k.toLowerCase()] = v
        }
        calls.push({
            url: String(input),
            method: init?.method ?? 'GET',
            headers,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        })
        const next = responses[index++]
        if (!next) throw new Error(`mockFetch: no response queued for call ${index}`)
        return typeof next === 'function' ? next() : next
    }
    return Object.assign(impl, { calls }) as MockFetch
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
    })
}

/**
 * A JSONL stream response.
 *
 * `chunks` are written verbatim, so a test can split a JSON object across reads
 * or omit the final newline — both of which the real wire does.
 */
export function streamResponse(chunks: string[], init: ResponseInit = {}): Response {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
        },
    })
    return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/jsonl' },
        ...init,
    })
}

export const USER_ID = 'user_2aBcDeFgHiJkLmNoPqRsTuVwXyZ'
export const AGENT_ID = '__cominty_agents::agent.chat'
export const MESSAGE_ID = '11111111-2222-3333-4444-555555555555'
export const THREAD_ID = '99999999-8888-7777-6666-555555555555'

export function assistantMessage(overrides: Record<string, unknown> = {}) {
    return {
        id: MESSAGE_ID,
        thread_id: THREAD_ID,
        role: 'assistant',
        content: 'Hello from the agent.',
        questions: null,
        live: false,
        status: 'success',
        events: null,
        structured_output: null,
        files: [],
        ...overrides,
    }
}

export function startedThread(overrides: Record<string, unknown> = {}) {
    return {
        id: THREAD_ID,
        name: 'A thread',
        created_at: '2026-09-14T10:00:00Z',
        live: true,
        starred: false,
        agent: { id: AGENT_ID, name: 'General chat' },
        messages: [
            { ...assistantMessage(), role: 'user', id: 'user-msg', content: 'Hi' },
            { ...assistantMessage(), live: true, status: 'running', content: '' },
        ],
        ...overrides,
    }
}

export function memoryFile(overrides: Record<string, unknown> = {}) {
    return {
        path: 'tone.md',
        namespace: 'brand-voice',
        purpose: 'writing style',
        content: 'Keep it casual.',
        created_at: '2026-09-14T10:00:00Z',
        updated_at: '2026-09-14T10:00:00Z',
        // The `+` matters: sent unencoded in a query, it would arrive as a space.
        version: '2026-09-14T10:00:00.123456+00:00',
        ...overrides,
    }
}

/** One progress event line, newline-terminated. */
export function eventLine(name: string, over: Record<string, unknown> = {}): string {
    return `${JSON.stringify({
        id: '1718000000000-0',
        correlation_id: 1,
        at: '2026-09-14T10:00:01Z',
        name,
        status: 'running',
        ...over,
    })}\n`
}
