import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_USAGE, run, type Io } from "../src/cli.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "why-cli-gh-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function repo(remote = "git@github.com:expressjs/express.git"): TestRepo {
  const r = createRepo([
    { message: "create", files: { "lib/response.js": "a\nres.status = 1;\n" } },
    {
      message: "Throw on invalid status codes (#4212)",
      files: { "lib/response.js": "a\nres.status = validate(code);\n" },
    },
  ]);
  cleanups.push(r.cleanup);
  r.git("remote", "add", "origin", remote);
  return r;
}

function fakeGitHub(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    calls.push(`${pathname}${search}`);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers["Authorization"]) calls.push(`auth:${headers["Authorization"]}`);
    const route = routes[`${pathname}${search}`];
    if (route === undefined) return new Response("{}", { status: 404 });
    if (route instanceof Response) return route;
    return new Response(JSON.stringify(route), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function routesFor(r: TestRepo, base = "/repos/expressjs/express") {
  return {
    [`${base}/commits/${r.commits[1]}/pulls`]: [
      {
        number: 4212,
        title: "Throw on invalid status codes",
        body: "Closes #3143",
        html_url: "https://github.com/expressjs/express/pull/4212",
        user: { login: "jonchurch" },
        state: "closed",
        merged_at: "2024-07-30T21:49:14Z",
      },
    ],
    [`${base}/pulls/4212`]: {
      number: 4212,
      title: "Throw on invalid status codes",
      body: "Closes #3143",
      html_url: "https://github.com/expressjs/express/pull/4212",
      user: { login: "jonchurch" },
      state: "closed",
      merged_at: "2024-07-30T21:49:14Z",
    },
    [`${base}/pulls/4212/comments?per_page=100`]: [
      {
        path: "lib/response.js",
        body: "Should this also reject 1000?\nMore detail here",
        html_url: "https://github.com/c/1",
        user: { login: "wesleytodd" },
        created_at: "2024-07-01T00:00:00Z",
      },
    ],
    [`${base}/issues/3143`]: {
      number: 3143,
      title: "res.status() accepts invalid codes",
      body: "It should throw",
      html_url: "https://github.com/expressjs/express/issues/3143",
      user: { login: "someone" },
      state: "closed",
      comments: 0,
    },
    [`${base}/commits/${r.commits[0]}/pulls`]: [],
  };
}

function io(cwd: string, fetch: typeof globalThis.fetch, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    cwd,
    env: { XDG_CACHE_HOME: tempDir(), ...env },
    fetch,
  };
  return { io: value, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("why CLI with GitHub", () => {
  it("shows the pull request, its review on this file and the issue it closes", async () => {
    const r = repo();
    const { fetch } = fakeGitHub(routesFor(r));
    const { io: value, stdout, stderr } = io(r.path, fetch);

    expect(await run(["lib/response.js:2"], value)).toBe(EXIT_OK);

    expect(stdout()).toContain(
      [
        "  Throw on invalid status codes (#4212)",
        "  changed at line 2",
        "  - res.status = 1;",
        "  + res.status = validate(code);",
        "  PR #4212  Throw on invalid status codes  (merged 2024-07-30, @jonchurch)",
        "    review @wesleytodd: Should this also reject 1000?",
        "  closes #3143  res.status() accepts invalid codes  (closed)",
        "",
      ].join("\n"),
    );
    expect(stdout()).toContain("Sources: 2 commits, 1 pull request, 1 issue\n");
    expect(stderr()).toBe("");
  });

  it("includes the evidence in --json output", async () => {
    const r = repo();
    const { fetch } = fakeGitHub(routesFor(r));
    const { io: value, stdout } = io(r.path, fetch);

    await run(["lib/response.js:2", "--json"], value);
    const json = JSON.parse(stdout());

    expect(json.github).toEqual({ owner: "expressjs", repo: "express" });
    expect(json.changes[0].evidence.pullRequest.number).toBe(4212);
    expect(json.changes[0].evidence.issues[0]).toMatchObject({ number: 3143, link: "closes" });
    expect(json.changes[1].evidence).toEqual({ issues: [] });
  });

  it("sends the token from GITHUB_TOKEN, or GH_TOKEN when that is the one set", async () => {
    for (const env of [{ GITHUB_TOKEN: "t1" }, { GH_TOKEN: "t2" }]) {
      const r = repo();
      const { fetch, calls } = fakeGitHub(routesFor(r));
      await run(["lib/response.js:2"], io(r.path, fetch, env).io);
      expect(calls).toContain(`auth:Bearer ${Object.values(env)[0]}`);
    }
  });

  it("caches answers so a second run makes no requests", async () => {
    const r = repo();
    const cache = tempDir();
    const first = fakeGitHub(routesFor(r));
    await run(["lib/response.js:2"], io(r.path, first.fetch, { XDG_CACHE_HOME: cache }).io);
    expect(readdirSync(join(cache, "why", "github")).length).toBeGreaterThan(0);

    const second = fakeGitHub(routesFor(r));
    await run(["lib/response.js:2"], io(r.path, second.fetch, { XDG_CACHE_HOME: cache }).io);
    expect(second.calls).toEqual([]);

    const refreshed = fakeGitHub(routesFor(r));
    await run(
      ["lib/response.js:2", "--refresh"],
      io(r.path, refreshed.fetch, { XDG_CACHE_HOME: cache }).io,
    );
    expect(refreshed.calls.length).toBeGreaterThan(0);
  });

  it("skips GitHub entirely with --no-github", async () => {
    const r = repo();
    const { fetch, calls } = fakeGitHub(routesFor(r));
    const { io: value, stdout } = io(r.path, fetch);

    expect(await run(["lib/response.js:2", "--no-github"], value)).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(stdout()).not.toContain("Sources:");
  });

  it("uses the repository given with --github", async () => {
    const r = repo("https://gitlab.com/me/fork.git");
    const { fetch, calls } = fakeGitHub(routesFor(r, "/repos/other/project"));

    await run(["lib/response.js:2", "--github", "other/project"], io(r.path, fetch).io);
    expect(calls[0]).toBe(`/repos/other/project/commits/${r.commits[1]}/pulls`);
  });

  it("rejects a malformed --github value", async () => {
    const r = repo();
    const { fetch } = fakeGitHub({});
    const { io: value, stderr } = io(r.path, fetch);

    expect(await run(["lib/response.js:2", "--github", "../x"], value)).toBe(EXIT_USAGE);
    expect(stderr()).toMatch(/owner\/repo/);
  });

  it("shows git history only when no remote is on GitHub", async () => {
    const r = repo("https://gitlab.com/me/app.git");
    const { fetch, calls } = fakeGitHub({});
    const { io: value, stdout } = io(r.path, fetch);

    expect(await run(["lib/response.js:2"], value)).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(stdout()).toContain("2 changes, newest first");
  });

  it("still prints the trace and warns when GitHub's limit is reached", async () => {
    const r = repo();
    const limited = new Response("{}", {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      },
    });
    const { fetch } = fakeGitHub({
      [`/repos/expressjs/express/commits/${r.commits[1]}/pulls`]: limited,
    });
    const { io: value, stdout, stderr } = io(r.path, fetch);

    expect(await run(["lib/response.js:2"], value)).toBe(EXIT_OK);
    expect(stdout()).toContain("res.status = validate(code);");
    expect(stderr()).toMatch(/^why: warning: GitHub rate limit reached, .*Set GITHUB_TOKEN/);
  });
});
