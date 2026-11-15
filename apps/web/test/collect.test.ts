import { describe, expect, it } from "vitest";
import type { LinkedChange, LinkedHistory } from "@why/core";
import { collectAnswer, emptySources, isAnswerable, issueKey } from "../scripts/collect.ts";

function change(commit: string, extra: Partial<LinkedChange> = {}): LinkedChange {
  return {
    commit,
    authorName: "Ada",
    authorEmail: "ada@example.com",
    date: "2024-07-30T00:00:00.000Z",
    subject: `subject ${commit}`,
    body: "",
    path: "lib/response.js",
    lineNumber: 10,
    kind: "modified",
    before: ["old"],
    after: ["new"],
    evidence: { issues: [] },
    ...extra,
  };
}

const pr = {
  number: 4212,
  title: "Throw on invalid status codes",
  url: "https://github.com/expressjs/express/pull/4212",
  author: "jonchurch",
  state: "merged" as const,
  mergedAt: "2024-07-30T21:49:14Z",
  batch: false,
  commitCount: 30,
  body: "Closes #3143",
  reviewComments: [
    {
      author: "blake",
      body: "Keep JSON.stringify?",
      url: "https://github.com/c/1",
      createdAt: "2024-07-01",
    },
  ],
};

const issue = {
  owner: "expressjs",
  repo: "express",
  number: 3143,
  title: "Invalid codes",
  url: "https://github.com/expressjs/express/issues/3143",
  author: "someone",
  state: "closed" as const,
  isPullRequest: true,
  link: "closes" as const,
  body: "",
  comments: [],
  commentCount: 0,
};

function history(...changes: LinkedChange[]): LinkedHistory {
  return {
    root: "/repo",
    path: "lib/response.js",
    line: 10,
    rev: "abc",
    content: "new",
    github: { owner: "expressjs", repo: "express" },
    warnings: [],
    changes,
  };
}

describe("collectAnswer", () => {
  it("keeps each step small and stores commits, pull requests and issues once", () => {
    const sources = emptySources();
    const a = collectAnswer(
      history(
        change("c2", { evidence: { pullRequest: pr, issues: [issue] } }),
        change("c1", { kind: "moved", movedFrom: { path: "lib/old.js", lineNumber: 3 } }),
      ),
      sources,
    );
    const b = collectAnswer(
      history(change("c2", { evidence: { pullRequest: pr, issues: [issue] } })),
      sources,
    );

    expect(a.steps[0]).toEqual({
      commit: "c2",
      kind: "modified",
      path: "lib/response.js",
      lineNumber: 10,
      before: ["old"],
      after: ["new"],
      pullRequest: 4212,
      reviews: pr.reviewComments,
      issues: [{ key: "expressjs/express#3143", link: "closes" }],
    });
    expect(a.steps[1]).toMatchObject({
      kind: "moved",
      movedFrom: { path: "lib/old.js", lineNumber: 3 },
    });
    expect(a.steps[1]).not.toHaveProperty("pullRequest");
    expect(b.steps[0]!.pullRequest).toBe(4212);

    expect(Object.keys(sources.commits)).toEqual(["c2", "c1"]);
    expect(sources.commits["c2"]).toEqual({
      sha: "c2",
      author: "Ada",
      date: "2024-07-30T00:00:00.000Z",
      subject: "subject c2",
      body: "",
    });
    expect(Object.keys(sources.pullRequests)).toEqual(["4212"]);
    expect(sources.pullRequests["4212"]).not.toHaveProperty("reviewComments");
    expect(sources.issues["expressjs/express#3143"]).toMatchObject({
      number: 3143,
      isPullRequest: true,
    });
  });

  it("keeps possible origins for ambiguous moves", () => {
    const answer = collectAnswer(
      history(
        change("c1", {
          kind: "added",
          before: [],
          possibleOrigins: [{ path: "a.js", lineNumber: 2 }],
        }),
      ),
      emptySources(),
    );
    expect(answer.steps[0]!.possibleOrigins).toEqual([{ path: "a.js", lineNumber: 2 }]);
  });
});

describe("isAnswerable", () => {
  it.each(["  return this;", "const style = node.style;", "res.status = function status(code) {"])(
    "answers %s",
    (line) => expect(isAnswerable(line)).toBe(true),
  );

  it.each(["", "   }", "  });", "// comment line", " * jsdoc line", "# python comment", "x = 1"])(
    "skips %j",
    (line) => expect(isAnswerable(line)).toBe(false),
  );
});

describe("issueKey", () => {
  it("lower-cases owner and repo", () => {
    expect(issueKey({ owner: "PalLets", repo: "Flask", number: 7 })).toBe("pallets/flask#7");
  });
});
