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
        const err = new HubSpotApiError(res.status, path, text);
        if (!err.retryable) throw new TypeError(err.message); // non-retryable, stop immediately
        throw err; // retryable, let @std/async/retry handle backoff
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

/** Run async functions with limited concurrency. */
export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
