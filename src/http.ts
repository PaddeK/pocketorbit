export const USER_AGENT = "pocketorbit";
const JSON_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

export class HttpError extends Error {
    constructor(readonly status: number, readonly body: string, url: string) {
        super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 300)}`);
    }
}

export interface RequestOptions {
    headers?: Record<string, string>;
    /** Sent as application/x-www-form-urlencoded */
    form?: Record<string, string>;
    /** Sent as JSON */
    json?: unknown;
}

async function send(method: string, url: string, options: RequestOptions, timeoutMs: number): Promise<Response> {
    const headers: Record<string, string> = { "user-agent": USER_AGENT, ...options.headers };
    let body: string | undefined;
    if (options.form) {
        body = new URLSearchParams(options.form).toString();
        headers["content-type"] = "application/x-www-form-urlencoded";
    } else if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers["content-type"] = "application/json";
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new HttpError(res.status, await res.text(), url);
    return res;
}

/** Send a request and decode the JSON response (null for an empty body). */
export async function requestJson<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
    const text = await (await send(method, url, options, JSON_TIMEOUT_MS)).text();
    return (text ? JSON.parse(text) : null) as T;
}

/** GET url and pass the body to sink chunk by chunk, so large files never sit in memory. */
export async function stream(url: string, sink: (chunk: Uint8Array) => void, headers: Record<string, string> = {}): Promise<void> {
    const res = await send("GET", url, { headers }, DOWNLOAD_TIMEOUT_MS);
    if (!res.body) return;
    for await (const chunk of res.body) sink(chunk);
}
