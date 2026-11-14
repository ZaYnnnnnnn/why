import { createRepo, type CommitSpec, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { findMovedFrom, type MoveTarget } from "../src/index.ts";
import { normalize, parseRemovedLines, similarity } from "../src/findMovedFrom.ts";

const repos: TestRepo[] = [];

function make(history: CommitSpec[]): TestRepo {
  const repo = createRepo(history);
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

function lines(...text: string[]): string {
  return `${text.join("\n")}\n`;
}

async function find(repo: TestRepo, target: Omit<MoveTarget, "commit">, commitIndex = 1) {
  const root = repo.git("rev-parse", "--show-toplevel");
  return findMovedFrom(root, { ...target, commit: repo.commits[commitIndex]! });
}

const TARGET_FN = ["function target() {", "  return compute(42);", "}"];

describe("findMovedFrom", () => {
  it("finds a line moved to another file", async () => {
    const repo = make([
      {
        message: "create",
        files: { "a.js": lines("const x = 1;", "", ...TARGET_FN, "", "const y = 2;") },
      },
      {
        message: "extract target",
        files: {
          "a.js": lines("const x = 1;", "", "const y = 2;"),
          "b.js": lines("import x from './x';", "", ...TARGET_FN),
        },
      },
    ]);

    const result = await find(repo, { path: "b.js", lineNumber: 4, text: "  return compute(42);" });

    expect(result).toEqual({
      status: "moved",
      from: { path: "a.js", lineNumber: 4 },
      text: "  return compute(42);",
      match: "exact",
    });
  });

  it("finds a block moved to another place in the same file", async () => {
    const block = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"];
    const status = ["// set status", "function status(code) {", "  this.statusCode = code;", "}"];
    const repo = make([
      {
        message: "create",
        files: { "res.js": lines(...block, ...block.map((l) => `${l} // x`), "", ...status) },
      },
      {
        message: "misc",
        files: { "res.js": lines(...status, "", ...block, ...block.map((l) => `${l} // x`)) },
      },
    ]);

    const result = await find(repo, {
      path: "res.js",
      lineNumber: 3,
      text: "  this.statusCode = code;",
    });

    expect(result).toMatchObject({ status: "moved", from: { path: "res.js", lineNumber: 12 } });
  });

  it("matches a moved line whose spacing changed", async () => {
    const repo = make([
      { message: "create", files: { "a.js": lines("one();", "  return compute(a,b);", "two();") } },
      {
        message: "move and format",
        files: { "a.js": lines("one();", "two();"), "b.js": lines("  return compute( a, b );") },
      },
    ]);

    const result = await find(repo, {
      path: "b.js",
      lineNumber: 1,
      text: "  return compute( a, b );",
    });

    expect(result).toMatchObject({
      status: "moved",
      from: { path: "a.js", lineNumber: 2 },
      match: "exact",
    });
  });

  it("matches a similar line when its neighbours moved with it", async () => {
    const before = [
      "/**",
      " * Set status code.",
      " */",
      "res.status = function(code){",
      "  this.statusCode = code;",
      "  return this;",
      "};",
    ];
    const after = [...before];
    after[3] = "res.status = function status(code){";
    const repo = make([
      { message: "create", files: { "a.js": lines("intro();", ...before) } },
      { message: "move and rename", files: { "a.js": lines("intro();"), "b.js": lines(...after) } },
    ]);

    const result = await find(repo, { path: "b.js", lineNumber: 4, text: after[3]! });

    expect(result).toMatchObject({
      status: "moved",
      from: { path: "a.js", lineNumber: 5 },
      match: "similar",
    });
  });

  it("does not match a similar line without shared neighbours", async () => {
    const repo = make([
      {
        message: "create",
        files: { "a.js": lines("aaa();", "res.status = function(code){", "bbb();") },
      },
      {
        message: "unrelated",
        files: {
          "a.js": lines("aaa();", "bbb();"),
          "b.js": lines("ccc();", "res.status = function status(code){", "ddd();"),
        },
      },
    ]);

    const result = await find(repo, {
      path: "b.js",
      lineNumber: 2,
      text: "res.status = function status(code){",
    });

    expect(result).toEqual({ status: "none" });
  });

  it("moves a common line like } only when its neighbours moved too", async () => {
    const repo = make([
      { message: "create", files: { "a.js": lines("keep();", ...TARGET_FN) } },
      { message: "extract", files: { "a.js": lines("keep();"), "b.js": lines(...TARGET_FN) } },
    ]);

    const result = await find(repo, { path: "b.js", lineNumber: 3, text: "}" });

    expect(result).toMatchObject({ status: "moved", from: { path: "a.js", lineNumber: 4 } });
  });

  it("keeps a common line as new when its neighbours differ", async () => {
    const repo = make([
      { message: "create", files: { "a.js": lines("keep();", "function a() {", "  one();", "}") } },
      {
        message: "replace",
        files: { "a.js": lines("keep();"), "b.js": lines("function b() {", "  two();", "}") },
      },
    ]);

    const result = await find(repo, { path: "b.js", lineNumber: 3, text: "}" });

    expect(result).toEqual({ status: "none" });
  });

  it("reports a genuinely new line as not moved", async () => {
    const repo = make([
      { message: "create", files: { "a.js": lines("const old = 1;", "keep();") } },
      {
        message: "new code",
        files: { "a.js": lines("const brandNew = computeSomething();", "keep();") },
      },
    ]);

    const result = await find(repo, {
      path: "a.js",
      lineNumber: 1,
      text: "const brandNew = computeSomething();",
    });

    expect(result).toEqual({ status: "none" });
  });

  it("refuses to guess between equally good sources", async () => {
    const shared = lines("first();", "const shared = makeThing(1);", "last();");
    const repo = make([
      { message: "create", files: { "a.js": shared, "b.js": shared } },
      {
        message: "merge files",
        files: {
          "a.js": null,
          "b.js": null,
          "c.js": lines(
            "alpha();",
            "beta();",
            "gamma();",
            "const shared = makeThing(1);",
            "delta();",
            "epsilon();",
            "zeta();",
          ),
        },
      },
    ]);

    const result = await find(repo, {
      path: "c.js",
      lineNumber: 4,
      text: "const shared = makeThing(1);",
    });

    expect(result).toEqual({
      status: "ambiguous",
      candidates: [
        { path: "a.js", lineNumber: 2 },
        { path: "b.js", lineNumber: 2 },
      ],
    });
  });

  it("returns none for the first commit of a repository", async () => {
    const repo = make([{ message: "root", files: { "a.js": lines("const x = 1;") } }]);

    const result = await find(repo, { path: "a.js", lineNumber: 1, text: "const x = 1;" }, 0);

    expect(result).toEqual({ status: "none" });
  });

  it("handles file names with spaces", async () => {
    const repo = make([
      { message: "create", files: { "my file.js": lines("keep();", "const moved = value(1);") } },
      {
        message: "move",
        files: {
          "my file.js": lines("keep();"),
          "other file.js": lines("const moved = value(1);"),
        },
      },
    ]);

    const result = await find(repo, {
      path: "other file.js",
      lineNumber: 1,
      text: "const moved = value(1);",
    });

    expect(result).toMatchObject({ status: "moved", from: { path: "my file.js", lineNumber: 2 } });
  });
});

describe("parseRemovedLines", () => {
  it("records old line numbers across several hunks and files", () => {
    const diff = [
      "diff --git a/a.js b/a.js",
      "--- a/a.js",
      "+++ b/a.js",
      "@@ -2 +1,0 @@",
      "-two",
      "@@ -10,2 +9 @@",
      "-ten",
      "--- eleven",
      "+changed",
      "diff --git a/b.js b/b.js",
      "deleted file mode 100644",
      "--- a/b.js",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-only",
    ].join("\n");

    expect(parseRemovedLines(diff)).toEqual([
      { path: "a.js", lineNumber: 2, text: "two" },
      { path: "a.js", lineNumber: 10, text: "ten" },
      { path: "a.js", lineNumber: 11, text: "-- eleven" },
      { path: "b.js", lineNumber: 1, text: "only" },
    ]);
  });
});

describe("matching helpers", () => {
  it("ignores all whitespace when normalising", () => {
    expect(normalize("  return  compute( a,\tb );")).toBe("returncompute(a,b);");
  });

  it("scores similar lines high and different lines low", () => {
    expect(
      similarity("res.status=function(code){", "res.status=functionstatus(code){"),
    ).toBeGreaterThan(0.8);
    expect(similarity("res.status=function(code){", "constx=loadConfig();")).toBeLessThan(0.3);
  });
});
