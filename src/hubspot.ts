import { Client } from "@hubspot/api-client";
import { retry } from "@std/async/retry";

let _client: Client | undefined;

export function getClient(): Client {
  if (_client) return _client;
  const token = Deno.env.get("HUBSPOT_ACCESS_TOKEN");
  if (!token) {
    throw new Error(
      "HUBSPOT_ACCESS_TOKEN is not set. Create a .env file with your token.",
    );
  }
  _client = new Client({ accessToken: token });
  return _client;
}

class HubSpotApiError extends Error {
  constructor(public status: number, path: string, body: string) {
    super(`HubSpot API ${status} ${path}: ${body}`);
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Direct HTTP call to HubSpot APIs not covered by the SDK, with exponential backoff retry. */
export async function hubspotFetch<T>(
  path: string,
  params?: Record<string, string>,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const token = Deno.env.get("HUBSPOT_ACCESS_TOKEN");
  const url = new URL(`https://api.hubapi.com${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (body) init.body = JSON.stringify(body);

  return retry(
    async () => {
      const res = await fetch(url.toString(), init);
      if (!res.ok) {
        const text = await res.text();
        throw new HubSpotApiError(res.status, path, text);
      }
      return res.json() as Promise<T>;
    },
    {
      maxAttempts: 5,
      minTimeout: 1000,
      maxTimeout: 30000,
      multiplier: 2,
      jitter: 1,
      isRetriable: (err) => err instanceof HubSpotApiError && err.retryable,
    },
  );
}

/**
 * Process items in parallel with limited concurrency, streaming results
 * to an async callback in original order. Frees each result from memory
 * as soon as it's flushed, so at most `concurrency` results are buffered.
 */
export async function parallelStream<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  flush: (result: R, index: number) => Promise<void>,
): Promise<void> {
  const buffer = new Map<number, R>();
  let nextToFlush = 0;
  let fetchIndex = 0;

  async function tryFlush() {
    while (buffer.has(nextToFlush)) {
      const result = buffer.get(nextToFlush)!;
      buffer.delete(nextToFlush);
      await flush(result, nextToFlush);
      nextToFlush++;
    }
  }

  async function worker() {
    while (fetchIndex < items.length) {
      const i = fetchIndex++;
      const result = await fn(items[i], i);
      buffer.set(i, result);
      await tryFlush();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
