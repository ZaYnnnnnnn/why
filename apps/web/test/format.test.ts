import { describe, expect, it } from "vitest";
import {
  describeStep,
  fileUrl,
  firstLine,
  formatDate,
  issueLabel,
  languageFor,
  parseLineHash,
} from "../src/lib/format.ts";
import type { DemoIssue, DemoStep } from "../src/lib/types.ts";

const github = { owner: "expressjs", repo: "express" };

const step = (extra: Partial<DemoStep>): DemoStep => ({
  commit: "abc",
  kind: "modified",
  path: "lib/response.js",
  lineNumber: 72,
  before: [],
  after: [],
  ...extra,
});

describe("format helpers", () => {
  it("describes added, changed and moved steps, naming another file only when it differs", () => {
    expect(describeStep(step({ kind: "added" }), "lib/response.js")).toBe("Added at line 72");
    expect(describeStep(step({ path: "lib/old.js" }), "lib/response.js")).toBe(
      "Changed at line 72 in lib/old.js",
    );
    expect(
      describeStep(
        step({ kind: "moved", movedFrom: { path: "lib/response.js", lineNumber: 149 } }),
        "lib/response.js",
      ),
    ).toBe("Moved to line 72 from lib/response.js:149");
  });

  it("labels issues, dropping the owner and repo for the same project", () => {
    const issue = {
      owner: "expressjs",
      repo: "express",
      number: 3143,
      isPullRequest: true,
    } as DemoIssue;
    expect(issueLabel(issue, github)).toBe("PR #3143");
    expect(
      issueLabel({ ...issue, owner: "pillarjs", repo: "send", isPullRequest: false }, github),
    ).toBe("pillarjs/send#3143");
  });

  it("reads #L72 links and ignores anything else", () => {
    expect(parseLineHash("#L72")).toBe(72);
    expect(parseLineHash("#L")).toBeUndefined();
    expect(parseLineHash("#readme")).toBeUndefined();
    expect(parseLineHash("")).toBeUndefined();
  });

  it("formats dates in UTC so the build does not depend on the time zone", () => {
    expect(formatDate("2024-07-30T23:30:00.000Z")).toBe("30 Jul 2024");
    expect(formatDate("not a date")).toBe("not a date");
  });

  it("picks the language from the file name", () => {
    expect(languageFor("lib/response.js")).toBe("javascript");
    expect(languageFor("src/flask/app.py")).toBe("python");
    expect(languageFor("a.tsx")).toBe("typescript");
    expect(languageFor("README")).toBe("text");
  });

  it("builds GitHub links to a file at a commit", () => {
    expect(fileUrl(github, "43fca52", "lib/response.js", 72)).toBe(
      "https://github.com/expressjs/express/blob/43fca52/lib/response.js#L72",
    );
  });

  it("takes the first non-empty line and shortens long ones", () => {
    expect(firstLine("\n\n  Hello there\nmore")).toBe("Hello there");
    expect(firstLine("x".repeat(200), 10)).toBe("xxxxxxxxx…");
  });
});
