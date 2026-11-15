import type { LineChange, LinkedHistory } from "@why/core";
import { describe, expect, it } from "vitest";
import type { Lookup } from "../src/lookup.ts";
import { escapeHtml, renderBody, renderPage, type ViewState } from "../src/render.ts";

const change = (extra: Partial<LineChange> = {}): LineChange => ({
  commit: "723b5450000000000000000000000000000000000",
  authorName: "Jon Church",
  authorEmail: "j@example.com",
  date: "2024-07-30T00:00:00.000Z",
  subject: "Throw on invalid status codes (#4212)",
  body: "",
  path: "lib/response.js",
  lineNumber: 78,
  kind: "added",
  before: [],
  after: ["throw new RangeError()"],
  ...extra,
});

const linked = (changes: LinkedHistory["changes"]): LinkedHistory => ({
  root: "/repo",
  path: "lib/response.js",
  line: 72,
  rev: "HEAD",
  content: "throw new RangeError()",
  github: { owner: "expressjs", repo: "express" },
  warnings: [],
  changes,
});

function state(lookup: Lookup, extra: Partial<ViewState> = {}): ViewState {
  return {
    lookup,
    fileName: "lib/response.js",
    lineText: "  throw new RangeError()",
    signedIn: true,
    ...extra,
  };
}

describe("renderBody", () => {
  it("shows each step with its commit link, pull request, reviews and issues", () => {
    const html = renderBody(
      state({
        status: "found",
        editorLine: 72,
        warnings: [],
        history: linked([
          {
            ...change(),
            evidence: {
              pullRequest: {
                number: 4212,
                title: "Throw on invalid status codes",
                url: "https://github.com/expressjs/express/pull/4212",
                author: "jonchurch",
                state: "merged",
                mergedAt: "2024-07-30T21:49:14Z",
                batch: false,
                body: "",
                reviewComments: [
                  {
                    author: "blakeembrey",
                    body: "Keep JSON.stringify?",
                    url: "https://github.com/r/1",
                    createdAt: "x",
                  },
                ],
              },
              issues: [
                {
                  owner: "expressjs",
                  repo: "express",
                  number: 3143,
                  title: "Gracefully handle invalid status codes",
                  url: "https://github.com/expressjs/express/pull/3143",
                  author: "x",
                  state: "closed",
                  isPullRequest: true,
                  link: "closes",
                  body: "",
                  comments: [],
                  commentCount: 0,
                },
              ],
            },
          },
        ]),
      }),
    );

    expect(html).toContain("lib/response.js:72");
    expect(html).toContain(
      'data-href="https://github.com/expressjs/express/commit/723b5450000000000000000000000000000000000"',
    );
    expect(html).toContain("Throw on invalid status codes (#4212)");
    expect(html).toContain("Added at line 78");
    expect(html).toContain('<span class="add">+ throw new RangeError()</span>');
    expect(html).toContain(">PR #4212</a> Throw on invalid status codes");
    expect(html).toContain("Merged 2024-07-30 by @jonchurch");
    expect(html).toContain(
      '>@blakeembrey</a> <span class="muted">on this file:</span> Keep JSON.stringify?',
    );
    expect(html).toContain(">PR #3143</a> Gracefully handle invalid status codes");
    expect(html).toContain('data-action="explain"');
    expect(html).toContain("1 change, newest first");
  });

  it("escapes text from git and GitHub so it cannot inject HTML", () => {
    const html = renderBody(
      state({
        status: "found",
        editorLine: 1,
        warnings: [],
        history: linked([
          { ...change({ subject: '<img src=x onerror="alert(1)">' }), evidence: { issues: [] } },
        ]),
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("offers GitHub sign-in only when not signed in", () => {
    const lookup: Lookup = { status: "found", editorLine: 1, warnings: [], history: linked([]) };
    expect(renderBody(state(lookup, { signedIn: false }))).toContain('data-action="signIn"');
    expect(renderBody(state(lookup))).not.toContain('data-action="signIn"');
  });

  it("explains lines with no history", () => {
    expect(renderBody(state({ status: "uncommitted", editorLine: 3, reason: "added" }))).toContain(
      "Not committed yet",
    );
    expect(
      renderBody(state({ status: "uncommitted", editorLine: 3, reason: "modified" })),
    ).toContain("changes that are not committed yet");
    expect(renderBody(state({ status: "untracked", editorLine: 1 }))).toContain("not in git yet");
    expect(
      renderBody(
        state({ status: "failed", editorLine: 1, message: "Not inside a git repository" }),
      ),
    ).toContain("Not inside a git repository");
  });

  it("shows the AI summary with readable citations", () => {
    const html = renderBody(
      state(
        {
          status: "found",
          editorLine: 72,
          warnings: [],
          history: linked([{ ...change(), evidence: { issues: [] } }]),
        },
        {
          explanation: {
            status: "explained",
            provider: "claude-cli",
            model: "default",
            cached: true,
            sources: [
              { id: "C1", kind: "commit", label: "723b545" },
              { id: "I1", kind: "issue", label: "PR expressjs/express#3143" },
            ],
            explanation: {
              summary: "It rejects invalid status codes (see I1).",
              summaryCites: ["C1", "I1"],
              timeline: [{ text: "Added in C1.", cites: ["C1"] }],
              confidence: "high",
              gaps: ["Why 999"],
            },
          },
        },
      ),
    );
    expect(html).toContain("It rejects invalid status codes (see PR #3143).");
    expect(html).toContain("(723b545, PR #3143)");
    expect(html).toContain("Added in 723b545.");
    expect(html).toContain("Not in the evidence: Why 999");
    expect(html).toContain("Explained by claude-cli (cached)");
    expect(html).not.toContain('data-action="explain"');
  });

  it("shows why the AI summary is unavailable and lets the user retry", () => {
    const html = renderBody(
      state(
        { status: "found", editorLine: 1, warnings: [], history: linked([]) },
        {
          explanation: {
            status: "unavailable",
            reason: "The claude command is not signed in",
            sources: [],
          },
        },
      ),
    );
    expect(html).toContain("AI summary unavailable: The claude command is not signed in");
    expect(html).toContain("Try again");
  });
});

describe("renderPage", () => {
  it("locks the page down with a content security policy and a script nonce", () => {
    const page = renderPage("<p>hi</p>", { nonce: "abc123", cspSource: "vscode-resource:" });
    expect(page).toContain("default-src 'none'");
    expect(page).toContain("script-src 'nonce-abc123'");
    expect(page).toContain('<script nonce="abc123">');
    expect(page).toContain("<p>hi</p>");
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
