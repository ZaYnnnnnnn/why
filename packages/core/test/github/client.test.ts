import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitHubClient,
  defaultCacheDir,
  fileCache,
  FOREVER,
  memoryCache,
  ONE_WEEK,
} from "../../src/index.ts";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(...replies: Reply[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = replies.shift();
    if (!reply) throw new Error("no more fake replies");
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function client(fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const c = createGitHubClient({
    fetch,
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { client: c, sleeps };
}

describe("GitHub client", () => {
  it("sends the API headers and the token when one is set", async () => {
    const { fetch, calls } = fakeFetch({ body: { ok: 1 } });
    const { client: c } = client(fetch, { token: "secret-token" });

    expect(await c.get("/repos/a/b", { maxAgeMs: FOREVER })).toEqual({ ok: 1 });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/a/b");
    expect(calls[0]!.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      "User-Agent": "why-cli",
      Authorization: "Bearer secret-token",
    });
    expect(c.authenticated).toBe(true);
  });

  it("sends no Authorization header without a token", async () => {
    const { fetch, calls } = fakeFetch({ body: [] });
    const { client: c } = client(fetch);

    await c.get("/repos/a/b", { maxAgeMs: FOREVER });
    expect(calls[0]!.headers).not.toHaveProperty("Authorization");
    expect(c.authenticated).toBe(false);
  });

  it("answers from the cache while the entry is young enough", async () => {
    const { fetch, calls } = fakeFetch({ body: { n: 1 } }, { body: { n: 2 } });
    const cache = memoryCache();
    let now = NOW;
    const c = createGitHubClient({ fetch, cache, now: () => now });

    expect(await c.get("/x", { maxAgeMs: ONE_WEEK })).toEqual({ n: 1 });
    now += ONE_WEEK - 1;
    expect(await c.get("/x", { maxAgeMs: ONE_WEEK })).toEqual({ n: 1 });
    expect(calls).toHaveLength(1);

    now += 2;
    expect(await c.get("/x", { maxAgeMs: ONE_WEEK })).toEqual({ n: 2 });
    expect(calls).toHaveLength(2);
  });

  it("lets the caller choose how long an answer stays fresh based on its content", async () => {
    const { fetch, calls } = fakeFetch({ body: [] }, { body: [{ number: 7 }] });
    const cache = memoryCache();
    let now = NOW;
    const c = createGitHubClient({ fetch, cache, now: () => now });
    const maxAgeMs = (value: unknown) => ((value as unknown[]).length > 0 ? FOREVER : 1000);

    expect(await c.get("/pulls", { maxAgeMs })).toEqual([]);
    now += 1001;
    expect(await c.get("/pulls", { maxAgeMs })).toEqual([{ number: 7 }]);
    now += ONE_WEEK * 52;
    expect(await c.get("/pulls", { maxAgeMs })).toEqual([{ number: 7 }]);
    expect(calls).toHaveLength(2);
  });

  it("skips cached answers when refreshing but still stores new ones", async () => {
    const { fetch, calls } = fakeFetch({ body: { n: 1 } }, { body: { n: 2 } });
    const cache = memoryCache();
    await createGitHubClient({ fetch, cache }).get("/x", { maxAgeMs: FOREVER });

    const refreshed = createGitHubClient({ fetch, cache, refresh: true });
    expect(await refreshed.get("/x", { maxAgeMs: FOREVER })).toEqual({ n: 2 });
    expect(calls).toHaveLength(2);
    expect((await cache.get("/x"))?.value).toEqual({ n: 2 });
  });

  it("turns 404 and 422 into GITHUB_NOT_FOUND", async () => {
    for (const status of [404, 422]) {
      const { fetch } = fakeFetch({ status, body: { message: "Not Found" } });
      await expect(client(fetch).client.get("/x", { maxAgeMs: 0 })).rejects.toMatchObject({
        code: "GITHUB_NOT_FOUND",
      });
    }
  });

  it("waits for a rate limit that resets soon, then retries", async () => {
    const reset = String(NOW / 1000 + 20);
    const { fetch, calls } = fakeFetch(
      { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } },
      { body: { ok: true } },
    );
    const { client: c, sleeps } = client(fetch);

    expect(await c.get("/x", { maxAgeMs: 0 })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([21_000]);
  });

  it("honours retry-after on secondary rate limits", async () => {
    const { fetch } = fakeFetch(
      { status: 429, headers: { "retry-after": "5" } },
      { body: { ok: true } },
    );
    const { client: c, sleeps } = client(fetch);

    await c.get("/x", { maxAgeMs: 0 });
    expect(sleeps).toEqual([5000]);
  });

  it("stops with a clear message when the limit resets later, suggesting a token", async () => {
    const reset = String(NOW / 1000 + 30 * 60);
    const { fetch } = fakeFetch({
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
    });

    await expect(client(fetch).client.get("/x", { maxAgeMs: 0 })).rejects.toMatchObject({
      code: "GITHUB_RATE_LIMITED",
      message:
        "GitHub rate limit reached, resets at 12:30 UTC (in 30 min). Set GITHUB_TOKEN for 5,000 requests per hour instead of 60",
    });
  });

  it("leaves out the token hint when already authenticated", async () => {
    const reset = String(NOW / 1000 + 30 * 60);
    const { fetch } = fakeFetch({
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
    });

    await expect(client(fetch, { token: "t" }).client.get("/x", { maxAgeMs: 0 })).rejects.toThrow(
      /^GitHub rate limit reached, resets at 12:30 UTC \(in 30 min\)$/,
    );
  });

  it("retries server errors and network failures with growing delays", async () => {
    const { fetch, calls } = fakeFetch({ status: 502 }, new Error("socket hang up"), {
      body: { ok: true },
    });
    const { client: c, sleeps } = client(fetch);

    expect(await c.get("/x", { maxAgeMs: 0 })).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("gives up after three failed attempts", async () => {
    const { fetch } = fakeFetch({ status: 500 }, { status: 500 }, { status: 503 });

    await expect(client(fetch).client.get("/x", { maxAgeMs: 0 })).rejects.toMatchObject({
      code: "GITHUB_FAILED",
      message: "GitHub returned 503 for /x",
    });
  });

  it("explains a rejected token", async () => {
    const { fetch } = fakeFetch({ status: 401 });
    await expect(client(fetch, { token: "bad" }).client.get("/x", { maxAgeMs: 0 })).rejects.toThrow(
      /rejected the token/,
    );
  });
});

describe("file cache", () => {
  it("stores responses on disk without the token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "why-cache-"));
    dirs.push(dir);
    const { fetch } = fakeFetch({ body: { title: "public data" } });
    const c = createGitHubClient({ fetch, token: "secret-token", cache: fileCache(dir) });

    await c.get("/repos/a/b/pulls/1", { maxAgeMs: FOREVER });

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const stored = readFileSync(join(dir, files[0]!), "utf8");
    expect(stored).toContain("public data");
    expect(stored).not.toContain("secret-token");
    expect(await fileCache(dir).get("/repos/a/b/pulls/1")).toMatchObject({
      value: { title: "public data" },
    });
  });

  it("treats missing or broken files as a cache miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "why-cache-"));
    dirs.push(dir);
    expect(await fileCache(join(dir, "missing")).get("/x")).toBeUndefined();
  });

  it("uses XDG_CACHE_HOME when set", () => {
    expect(defaultCacheDir({ XDG_CACHE_HOME: "/tmp/c" })).toBe("/tmp/c/why/github");
    expect(defaultCacheDir({})).toMatch(/\.cache\/why\/github$/);
  });
});
