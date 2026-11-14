import { describe, expect, it } from "vitest";
import {
  createGitHubClient,
  linkHistory,
  memoryCache,
  truncate,
  type LineChange,
  type LineHistory,
} from "../../src/index.ts";

const REPO = { owner: "expressjs", repo: "express" };
const BASE = "/repos/expressjs/express";

type Route = unknown | { status: number; headers?: Record<string, string> };

function fakeGitHub(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    const key = `${pathname}${search}`;
    calls.push(key);
    const route = routes[key];
    if (route === undefined) return new Response("{}", { status: 404 });
    if (route && typeof route === "object" && "status" in route) {
      return new Response("{}", {
        status: (route as { status: number }).status,
        headers: (route as { headers?: Record<string, string> }).headers ?? {},
      });
    }
    return new Response(JSON.stringify(route), { status: 200 });
  }) as typeof globalThis.fetch;
  return {
    client: createGitHubClient({ fetch, cache: memoryCache(), sleep: async () => {} }),
    calls,
  };
}

function change(commit: string, overrides: Partial<LineChange> = {}): LineChange {
  return {
    commit,
    authorName: "Ada",
    authorEmail: "ada@example.com",
    date: "2024-07-30T00:00:00.000Z",
    subject: `commit ${commit}`,
    body: "",
    path: "lib/response.js",
    lineNumber: 10,
    kind: "modified",
    before: ["old"],
    after: ["new"],
    ...overrides,
  };
}

function history(...changes: LineChange[]): LineHistory {
  return { root: "/repo", path: "lib/response.js", line: 10, rev: "HEAD", content: "new", changes };
}

const user = (login: string) => ({ login });

const pull = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  body: `Body of ${number}`,
  html_url: `https://github.com/expressjs/express/pull/${number}`,
  user: user("jon"),
  state: "closed",
  merged_at: "2024-07-30T21:49:14Z",
  ...extra,
});

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  body: `Issue body ${number}`,
  html_url: `https://github.com/expressjs/express/issues/${number}`,
  user: user("reporter"),
  state: "closed",
  comments: 0,
  ...extra,
});

const comment = (author: string, body: string, created: string, path?: string) => ({
  user: user(author),
  body,
  html_url: `https://github.com/c/${author}`,
  created_at: created,
  ...(path ? { path } : {}),
});

describe("linkHistory", () => {
  it("attaches the pull request, its review comments on this file and linked issues", async () => {
    const { client } = fakeGitHub({
      [`${BASE}/commits/aaa/pulls`]: [pull(4212)],
      [`${BASE}/pulls/4212`]: pull(4212, { body: "Closes #3143\n\nAlso see #100" }),
      [`${BASE}/pulls/4212/comments?per_page=100`]: [
        comment("rev2", "second", "2024-07-02T00:00:00Z", "lib/response.js"),
        comment("other", "different file", "2024-07-01T00:00:00Z", "test/res.status.js"),
        comment("rev1", "first", "2024-07-01T00:00:00Z", "lib/response.js"),
      ],
      [`${BASE}/issues/3143`]: issue(3143, { comments: 2 }),
      [`${BASE}/issues/3143/comments?per_page=5`]: [
        comment("a", "I hit this too", "2020-01-01T00:00:00Z"),
      ],
      [`${BASE}/issues/100`]: issue(100, { state: "open" }),
    });

    const linked = await linkHistory(history(change("aaa")), { repo: REPO, client });
    const evidence = linked.changes[0]!.evidence;

    expect(linked.github).toEqual(REPO);
    expect(linked.warnings).toEqual([]);
    expect(evidence.pullRequest).toMatchObject({
      number: 4212,
      title: "PR 4212",
      author: "jon",
      state: "merged",
      mergedAt: "2024-07-30T21:49:14Z",
      body: "Closes #3143\n\nAlso see #100",
    });
    expect(evidence.pullRequest!.reviewComments.map((c) => [c.author, c.body])).toEqual([
      ["rev1", "first"],
      ["rev2", "second"],
    ]);
    expect(evidence.issues.map((i) => [i.number, i.link, i.state, i.commentCount])).toEqual([
      [3143, "closes", "closed", 2],
      [100, "mentions", "open", 0],
    ]);
    expect(evidence.issues[0]!.comments.map((c) => c.body)).toEqual(["I hit this too"]);
  });

  it("falls back to (#123) in the subject when GitHub knows no pull request", async () => {
    const { client } = fakeGitHub({
      [`${BASE}/commits/bbb/pulls`]: [],
      [`${BASE}/pulls/77`]: pull(77),
      [`${BASE}/pulls/77/comments?per_page=100`]: [],
    });

    const linked = await linkHistory(
      history(change("bbb", { subject: "Fix status codes (#77)" })),
      { repo: REPO, client },
    );

    expect(linked.changes[0]!.evidence.pullRequest?.number).toBe(77);
    expect(linked.changes[0]!.evidence.issues).toEqual([]);
  });

  it("reads issue links from the commit message and marks pull requests among them", async () => {
    const { client } = fakeGitHub({
      [`${BASE}/commits/ccc/pulls`]: [],
      [`${BASE}/issues/5`]: issue(5, { pull_request: { url: "x" } }),
      [`${BASE}/issues/6`]: issue(6),
      "/repos/pillarjs/send/issues/9": issue(9, {
        html_url: "https://github.com/pillarjs/send/issues/9",
      }),
    });

    const linked = await linkHistory(
      history(change("ccc", { body: "Fixes #6, follows #5, upstream pillarjs/send#9, gone #404" })),
      { repo: REPO, client },
    );

    expect(
      linked.changes[0]!.evidence.issues.map((i) => [
        i.owner,
        i.repo,
        i.number,
        i.link,
        i.isPullRequest,
      ]),
    ).toEqual([
      ["expressjs", "express", 6, "closes", false],
      ["expressjs", "express", 5, "mentions", true],
      ["pillarjs", "send", 9, "mentions", false],
    ]);
  });

  it("does not list a pull request as its own linked issue", async () => {
    const { client } = fakeGitHub({
      [`${BASE}/commits/ddd/pulls`]: [pull(12)],
      [`${BASE}/pulls/12`]: pull(12),
      [`${BASE}/pulls/12/comments?per_page=100`]: [],
    });

    const linked = await linkHistory(
      history(change("ddd", { subject: "Merge pull request #12" })),
      {
        repo: REPO,
        client,
      },
    );

    expect(linked.changes[0]!.evidence.issues).toEqual([]);
  });

  it("fetches a pull request shared by several steps only once", async () => {
    const { client, calls } = fakeGitHub({
      [`${BASE}/commits/e1/pulls`]: [pull(30)],
      [`${BASE}/commits/e2/pulls`]: [pull(30)],
      [`${BASE}/pulls/30`]: pull(30),
      [`${BASE}/pulls/30/comments?per_page=100`]: [],
    });

    const linked = await linkHistory(history(change("e1"), change("e2")), { repo: REPO, client });

    expect(linked.changes.map((c) => c.evidence.pullRequest?.number)).toEqual([30, 30]);
    expect(calls.filter((c) => c === `${BASE}/pulls/30`)).toHaveLength(1);
  });

  it("leaves evidence empty for commits from before pull requests", async () => {
    const { client } = fakeGitHub({ [`${BASE}/commits/fff/pulls`]: [] });

    const linked = await linkHistory(history(change("fff", { subject: "misc" })), {
      repo: REPO,
      client,
    });

    expect(linked.changes[0]!.evidence).toEqual({ issues: [] });
  });

  it("keeps what it found and stops when GitHub's rate limit runs out", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 3600);
    const { client } = fakeGitHub({
      [`${BASE}/commits/g1/pulls`]: [pull(1)],
      [`${BASE}/pulls/1`]: pull(1),
      [`${BASE}/pulls/1/comments?per_page=100`]: [],
      [`${BASE}/commits/g2/pulls`]: {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
      },
    });

    const linked = await linkHistory(history(change("g1"), change("g2"), change("g3")), {
      repo: REPO,
      client,
    });

    expect(linked.changes.map((c) => c.evidence.pullRequest?.number)).toEqual([
      1,
      undefined,
      undefined,
    ]);
    expect(linked.warnings).toHaveLength(1);
    expect(linked.warnings[0]).toMatch(/^GitHub rate limit reached/);
  });

  it("caps long descriptions and comments", async () => {
    const { client } = fakeGitHub({
      [`${BASE}/commits/hhh/pulls`]: [pull(2)],
      [`${BASE}/pulls/2`]: pull(2, { body: "x".repeat(10_000) }),
      [`${BASE}/pulls/2/comments?per_page=100`]: Array.from({ length: 8 }, (_, i) =>
        comment(`r${i}`, "y".repeat(5000), `2024-01-0${i + 1}T00:00:00Z`, "lib/response.js"),
      ),
    });

    const pr = (await linkHistory(history(change("hhh")), { repo: REPO, client })).changes[0]!
      .evidence.pullRequest!;

    expect(pr.body).toHaveLength(4000);
    expect(pr.body.endsWith("…")).toBe(true);
    expect(pr.reviewComments).toHaveLength(5);
    expect(pr.reviewComments[0]!.body).toHaveLength(1000);
  });
});

describe("truncate", () => {
  it("normalises line endings, trims and handles missing text", () => {
    expect(truncate(null, 10)).toBe("");
    expect(truncate("  a\r\nb  ", 10)).toBe("a\nb");
    expect(truncate("abcdefghijk", 5)).toBe("abcd…");
  });
});
