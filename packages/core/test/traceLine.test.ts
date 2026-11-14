import { join } from "node:path";
import { createRepo, type CommitSpec, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { traceLine } from "../src/index.ts";

const repos: TestRepo[] = [];

function make(history: CommitSpec[]): TestRepo {
  const repo = createRepo(history);
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

describe("traceLine", () => {
  it("lists every change to the line, newest first", async () => {
    const repo = make([
      { message: "create config", files: { "config.ts": "a\nb\nlimit = 10\n" } },
      { message: "raise limit", files: { "config.ts": "a\nb\nlimit = 20\n" } },
      { message: "raise limit again", files: { "config.ts": "a\nb\nlimit = 50\n" } },
    ]);

    const history = await traceLine({ cwd: repo.path, file: "config.ts", line: 3 });

    expect(history.content).toBe("limit = 50");
    expect(history.changes.map((c) => c.subject)).toEqual([
      "raise limit again",
      "raise limit",
      "create config",
    ]);
    expect(history.changes.map((c) => c.commit)).toEqual([...repo.commits].reverse());
    expect(history.changes[0]).toMatchObject({
      kind: "modified",
      before: ["limit = 20"],
      after: ["limit = 50"],
      lineNumber: 3,
      path: "config.ts",
    });
    expect(history.changes[2]).toMatchObject({ kind: "added", before: [], after: ["limit = 10"] });
  });

  it("keeps tracking the line when lines above it move it down", async () => {
    const repo = make([
      { message: "create", files: { "app.ts": "start\ntarget\n" } },
      { message: "edit target", files: { "app.ts": "start\ntarget v2\n" } },
      { message: "add header", files: { "app.ts": "// header\n// more\nstart\ntarget v2\n" } },
      {
        message: "add import",
        files: { "app.ts": "// header\n// more\nimport x\nstart\ntarget v2\n" },
      },
    ]);

    const history = await traceLine({ cwd: repo.path, file: "app.ts", line: 5 });

    expect(history.changes.map((c) => c.subject)).toEqual(["edit target", "create"]);
    expect(history.changes.map((c) => c.lineNumber)).toEqual([2, 2]);
  });

  it("returns a single change for a line never edited after it was written", async () => {
    const repo = make([
      { message: "create", files: { "a.ts": "keep\nchange\n" } },
      { message: "edit other line", files: { "a.ts": "keep\nchanged\n" } },
    ]);

    const history = await traceLine({ cwd: repo.path, file: "a.ts", line: 1 });

    expect(history.changes).toHaveLength(1);
    expect(history.changes[0]).toMatchObject({ subject: "create", kind: "added" });
  });

  it("finds the commit that inserted a line into an existing file", async () => {
    const repo = make([
      { message: "create", files: { "a.ts": "one\nthree\n" } },
      { message: "insert two", files: { "a.ts": "one\ntwo\nthree\n" } },
    ]);

    const history = await traceLine({ cwd: repo.path, file: "a.ts", line: 2 });

    expect(history.changes).toHaveLength(1);
    expect(history.changes[0]).toMatchObject({ subject: "insert two", kind: "added" });
  });

  it("keeps author, date and the full commit message", async () => {
    const repo = make([
      {
        message: "Fix timeout\n\nThe old value broke slow networks.\nSee issue #12.",
        files: { "a.ts": "timeout = 30\n" },
        author: { name: "Ada", email: "ada@example.com" },
        date: "2019-03-04T10:00:00Z",
      },
    ]);

    const [change] = (await traceLine({ cwd: repo.path, file: "a.ts", line: 1 })).changes;

    expect(change).toMatchObject({
      authorName: "Ada",
      authorEmail: "ada@example.com",
      date: "2019-03-04T10:00:00.000Z",
      subject: "Fix timeout",
      body: "The old value broke slow networks.\nSee issue #12.",
    });
  });

  it("handles lines that look like diff syntax", async () => {
    const repo = make([
      { message: "create", files: { "q.sql": "select 1;\n-- note\n" } },
      { message: "edit", files: { "q.sql": "select 1;\n--- note 2\n" } },
      { message: "plus", files: { "q.sql": "select 1;\n+++ @@ -1 +1 @@\n" } },
    ]);

    const history = await traceLine({ cwd: repo.path, file: "q.sql", line: 2 });

    expect(history.changes.map((c) => [c.before, c.after])).toEqual([
      [["--- note 2"], ["+++ @@ -1 +1 @@"]],
      [["-- note"], ["--- note 2"]],
      [[], ["-- note"]],
    ]);
  });

  it("follows the line through file renames and records the path at each step", async () => {
    const repo = make([
      { message: "create", files: { "util.js": "a\nvalue = 1\n" } },
      { message: "edit", files: { "util.js": "a\nvalue = 2\n" } },
      { message: "rename", renames: { "util.js": "lib/helpers.js" } },
      { message: "rename again", renames: { "lib/helpers.js": "src/lib/values.js" } },
      { message: "edit after rename", files: { "src/lib/values.js": "a\nvalue = 3\n" } },
    ]);

    const history = await traceLine({ cwd: repo.path, file: "src/lib/values.js", line: 2 });

    expect(history.changes.map((c) => [c.subject, c.path])).toEqual([
      ["edit after rename", "src/lib/values.js"],
      ["edit", "util.js"],
      ["create", "util.js"],
    ]);
  });

  it("works from a nested folder with a relative path", async () => {
    const repo = make([{ message: "create", files: { "src/lib/x.ts": "x\n" } }]);

    const history = await traceLine({ cwd: join(repo.path, "src"), file: "lib/x.ts", line: 1 });

    expect(history.path).toBe("src/lib/x.ts");
    expect(history.changes).toHaveLength(1);
  });

  it("traces from an older revision", async () => {
    const repo = make([
      { message: "v1", files: { "a.ts": "one\n" } },
      { message: "v2", files: { "a.ts": "two\n" } },
    ]);

    const history = await traceLine({
      cwd: repo.path,
      file: "a.ts",
      line: 1,
      rev: repo.commits[0]!,
    });

    expect(history.content).toBe("one");
    expect(history.changes.map((c) => c.subject)).toEqual(["v1"]);
  });

  describe("errors", () => {
    const base: CommitSpec[] = [{ message: "create", files: { "a.ts": "one\ntwo\n" } }];

    it("rejects a line past the end of the file", async () => {
      const repo = make(base);
      await expect(traceLine({ cwd: repo.path, file: "a.ts", line: 3 })).rejects.toMatchObject({
        code: "LINE_OUT_OF_RANGE",
        message: "a.ts has 2 lines at HEAD, so line 3 does not exist",
      });
    });

    it("rejects line numbers below 1 or not whole", async () => {
      const repo = make(base);
      for (const line of [0, -1, 1.5]) {
        await expect(traceLine({ cwd: repo.path, file: "a.ts", line })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
        });
      }
    });

    it("rejects a file that is not in the repository", async () => {
      const repo = make(base);
      await expect(traceLine({ cwd: repo.path, file: "nope.ts", line: 1 })).rejects.toMatchObject({
        code: "FILE_NOT_FOUND",
      });
    });

    it("rejects unknown revisions", async () => {
      const repo = make(base);
      await expect(
        traceLine({ cwd: repo.path, file: "a.ts", line: 1, rev: "no-such-branch" }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Unknown revision: no-such-branch",
      });
    });

    it("rejects revisions that look like command-line options", async () => {
      const repo = make(base);
      await expect(
        traceLine({ cwd: repo.path, file: "a.ts", line: 1, rev: "--output=/tmp/pwned" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });
  });
});
