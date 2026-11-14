import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WhyError, type AiProvider, type CompletionRequest } from "@why/core";
import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_USAGE, run, type Io } from "../src/cli.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "why-cli-explain-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function repo(): TestRepo {
  const r = createRepo([
    { message: "create", files: { "lib/response.js": "a\nres.status = 1;\n" } },
    {
      message: "Throw on invalid status codes",
      files: { "lib/response.js": "a\nres.status = validate(code);\n" },
    },
  ]);
  cleanups.push(r.cleanup);
  r.git("remote", "add", "origin", "git@github.com:expressjs/express.git");
  return r;
}

function routes(r: TestRepo) {
  const base = "/repos/expressjs/express";
  return {
    [`${base}/commits/${r.commits[1]}/pulls`]: [
      { number: 4212, merged_at: "2024-07-30T21:49:14Z" },
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
    [`${base}/pulls/4212/comments?per_page=100`]: [],
    [`${base}/issues/3143`]: {
      number: 3143,
      title: "res.status() accepts invalid codes",
      body: "",
      html_url: "https://github.com/expressjs/express/issues/3143",
      user: { login: "someone" },
      state: "closed",
      comments: 0,
    },
    [`${base}/commits/${r.commits[0]}/pulls`]: [],
  };
}

function fakeFetch(table: Record<string, unknown>) {
  return (async (url: string) => {
    const { pathname, search } = new URL(url);
    const body = table[`${pathname}${search}`];
    return body === undefined
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
}

function fakeProvider(...answers: Array<unknown | Error>) {
  const requests: CompletionRequest[] = [];
  const provider: AiProvider = {
    name: "fake",
    model: "fake-1",
    complete: async (request) => {
      requests.push(request);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { provider, requests };
}

const answer = {
  summary: "It validates status codes so bad values fail loudly.",
  summaryCites: ["PR1", "I1"],
  timeline: [
    { text: "First version set the status directly.", cites: ["C2"] },
    { text: "Validation added after a report of silent failures.", cites: ["C1", "PR1", "I1"] },
  ],
  confidence: "high",
  gaps: ["Why 999 is the upper limit"],
};

function io(r: TestRepo, extra: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    cwd: r.path,
    env: { XDG_CACHE_HOME: tempDir() },
    fetch: fakeFetch(routes(r)),
    ...extra,
  };
  return { io: value, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("why --explain", () => {
  it("prints the explanation above the timeline with readable citations", async () => {
    const r = repo();
    const { provider } = fakeProvider(answer);
    const { io: value, stdout, stderr } = io(r, { provider });

    expect(await run(["lib/response.js:2", "--explain"], value)).toBe(EXIT_OK);

    expect(stdout()).toContain(
      [
        "lib/response.js:2",
        "  res.status = validate(code);",
        "",
        "Why",
        "  It validates status codes so bad values fail loudly. (PR #4212, #3143)",
        "",
        `  - First version set the status directly. (${r.commits[0]!.slice(0, 7)})`,
        `  - Validation added after a report of silent failures. (${r.commits[1]!.slice(0, 7)}, PR #4212, #3143)`,
        "",
        "  Confidence: high",
        "  Not in the evidence: Why 999 is the upper limit",
        "  Explained by fake fake-1",
        "",
        "2 changes, newest first",
      ].join("\n"),
    );
    expect(stderr()).toBe("");
  });

  it("turns IDs written inside the text into readable labels and drops repeated labels", async () => {
    const r = repo();
    const { provider } = fakeProvider({
      summary: "It was added for chaining (C2) and renamed later (C1, PR1).",
      summaryCites: ["C2", "C1"],
      timeline: [{ text: "PR1 merged the change.", cites: ["PR1", "PR1", "C1"] }],
      confidence: "medium",
      gaps: ["I1 does not say why 999."],
    });
    const { io: value, stdout } = io(r, { provider });

    await run(["lib/response.js:2", "--explain"], value);
    const short = (i: number) => r.commits[i]!.slice(0, 7);

    expect(stdout()).toContain(
      `  It was added for chaining and renamed later. (${short(0)}, ${short(1)})`,
    );
    expect(stdout()).toContain(`  - PR #4212 merged the change. (PR #4212, ${short(1)})`);
    expect(stdout()).toContain("  Not in the evidence: #3143 does not say why 999.");
  });

  it("includes the explanation in --json output", async () => {
    const r = repo();
    const { provider } = fakeProvider(answer);
    const { io: value, stdout } = io(r, { provider });

    await run(["lib/response.js:2", "--explain", "--json"], value);
    const json = JSON.parse(stdout());

    expect(json.explanation).toMatchObject({
      status: "explained",
      explanation: { confidence: "high" },
    });
    expect(json.changes).toHaveLength(2);
  });

  it("shows the timeline and a warning when the AI is unavailable", async () => {
    const r = repo();
    const { provider } = fakeProvider(
      new WhyError("AI_UNAVAILABLE", "The claude command is not signed in"),
    );
    const { io: value, stdout, stderr } = io(r, { provider });

    expect(await run(["lib/response.js:2", "--explain"], value)).toBe(EXIT_OK);
    expect(stdout()).not.toContain("Why\n");
    expect(stdout()).toContain("2 changes, newest first");
    expect(stderr()).toBe("why: AI explanation unavailable: The claude command is not signed in\n");
  });

  it("reuses a cached explanation on the next run", async () => {
    const r = repo();
    const env = { XDG_CACHE_HOME: tempDir() };
    await run(
      ["lib/response.js:2", "--explain"],
      io(r, { env, provider: fakeProvider(answer).provider }).io,
    );

    const second = fakeProvider();
    const { io: value, stdout } = io(r, { env, provider: second.provider });
    await run(["lib/response.js:2", "--explain"], value);

    expect(second.requests).toHaveLength(0);
    expect(stdout()).toContain("Explained by fake fake-1 (cached)");
  });

  it("does not call the AI without --explain", async () => {
    const r = repo();
    const { provider, requests } = fakeProvider(answer);
    await run(["lib/response.js:2"], io(r, { provider }).io);
    expect(requests).toHaveLength(0);
  });

  it("explains how to use the API provider without a key", async () => {
    const r = repo();
    const { io: value, stderr } = io(r);

    expect(await run(["lib/response.js:2", "--explain", "--ai", "anthropic"], value)).toBe(EXIT_OK);
    expect(stderr()).toMatch(/^why: AI explanation unavailable: Set ANTHROPIC_API_KEY/);
  });

  it("rejects an unknown provider", async () => {
    const r = repo();
    const { io: value, stderr } = io(r);

    expect(await run(["lib/response.js:2", "--explain", "--ai", "gpt"], value)).toBe(EXIT_USAGE);
    expect(stderr()).toBe("why: --ai must be one of claude-cli, anthropic\n");
  });
});
