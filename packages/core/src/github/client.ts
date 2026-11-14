import { WhyError } from "../errors.ts";
import { memoryCache, type Cache } from "./cache.ts";

export interface GitHubClientOptions {
  token?: string | undefined;
  cache?: Cache;
  refresh?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  baseUrl?: string;
}

export interface GetOptions {
  maxAgeMs: number | ((cached: unknown) => number);
}

export interface GitHubClient {
  get: <T>(path: string, options: GetOptions) => Promise<T>;
  readonly authenticated: boolean;
}

export const FOREVER = Number.POSITIVE_INFINITY;
export const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

const ATTEMPTS = 3;
const BACKOFF_MS = 500;

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const {
    token,
    cache = memoryCache(),
    refresh = false,
    fetch: doFetch = globalThis.fetch,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    maxWaitMs = 60_000,
    baseUrl = "https://api.github.com",
  } = options;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "why-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  async function get<T>(path: string, { maxAgeMs }: GetOptions): Promise<T> {
    if (!path.startsWith("/")) throw new WhyError("INVALID_ARGUMENT", `Bad API path: ${path}`);

    if (!refresh) {
      const cached = await cache.get(path);
      const limit = cached && (typeof maxAgeMs === "function" ? maxAgeMs(cached.value) : maxAgeMs);
      if (cached && limit !== undefined && now() - cached.storedAt <= limit) {
        return cached.value as T;
      }
    }

    for (let attempt = 1; ; attempt += 1) {
      const lastAttempt = attempt >= ATTEMPTS;
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, { headers });
      } catch (error) {
        if (lastAttempt) {
          throw new WhyError(
            "GITHUB_FAILED",
            `Could not reach GitHub: ${(error as Error).message}`,
            {
              cause: error,
            },
          );
        }
        await sleep(BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }

      if (response.ok) {
        const value = (await response.json()) as T;
        await cache.set(path, { value, storedAt: now() });
        return value;
      }

      if (response.status === 404 || response.status === 422) {
        throw new WhyError("GITHUB_NOT_FOUND", `GitHub has nothing at ${path}`);
      }

      const waitMs = rateLimitWait(response, now());
      if (waitMs !== undefined) {
        if (waitMs <= maxWaitMs && !lastAttempt) {
          await sleep(waitMs);
          continue;
        }
        throw new WhyError(
          "GITHUB_RATE_LIMITED",
          rateLimitMessage(response, now(), Boolean(token)),
        );
      }

      if (response.status === 401) {
        throw new WhyError(
          "GITHUB_FAILED",
          "GitHub rejected the token in GITHUB_TOKEN or GH_TOKEN",
        );
      }

      if (response.status >= 500 && !lastAttempt) {
        await sleep(BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }

      throw new WhyError("GITHUB_FAILED", `GitHub returned ${response.status} for ${path}`);
    }
  }

  return { get, authenticated: Boolean(token) };
}

function rateLimitWait(response: Response, nowMs: number): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined;

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;

  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) ? Math.max(0, reset * 1000 - nowMs) + 1000 : 60_000;
  }

  return response.status === 429 ? 60_000 : undefined;
}

function rateLimitMessage(response: Response, nowMs: number, authenticated: boolean): string {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const when =
    Number.isFinite(reset) && reset > 0
      ? `resets at ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC`
      : `try again in a minute`;
  const minutes = Number.isFinite(reset) ? Math.ceil((reset * 1000 - nowMs) / 60_000) : undefined;
  const wait = minutes && minutes > 0 ? ` (in ${minutes} min)` : "";
  const hint = authenticated ? "" : ". Set GITHUB_TOKEN for 5,000 requests per hour instead of 60";
  return `GitHub rate limit reached, ${when}${wait}${hint}`;
}
