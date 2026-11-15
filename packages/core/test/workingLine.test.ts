import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { mapLine, mapToCommittedLine, parseHunks } from "../src/workingLine.ts";

const repos: TestRepo[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

const COMMITTED = "a\nb\nc\nd\ne\n";

function repo(): TestRepo {
  const r = createRepo([{ message: "create", files: { "src/f.txt": COMMITTED } }]);
  repos.push(r);
  return r;
}

async function map(text: string, line: number) {
  const r = repo();
  return mapToCommittedLine({ root: r.path, path: "src/f.txt", line, text });
}

describe("mapToCommittedLine", () => {
  it("keeps the line number when the file matches the commit", async () => {
    expect(await map(COMMITTED, 3)).toEqual({ status: "committed", line: 3 });
  });

  it("shifts lines below an inserted line", async () => {
    const text = "a\nNEW\nb\nc\nd\ne\n";
    expect(await map(text, 1)).toEqual({ status: "committed", line: 1 });
    expect(await map(text, 3)).toEqual({ status: "committed", line: 2 });
    expect(await map(text, 6)).toEqual({ status: "committed", line: 5 });
  });

  it("shifts lines below a deleted line", async () => {
    const text = "a\nb\nd\ne\n";
    expect(await map(text, 2)).toEqual({ status: "committed", line: 2 });
    expect(await map(text, 3)).toEqual({ status: "committed", line: 4 });
  });

  it("reports lines typed since the last commit as added", async () => {
    expect(await map("a\nNEW\nb\nc\nd\ne\n", 2)).toEqual({
      status: "uncommitted",
      reason: "added",
    });
    expect(await map("a\nb\nc\nd\ne\nTAIL\n", 6)).toEqual({
      status: "uncommitted",
      reason: "added",
    });
  });

  it("reports edited lines as modified", async () => {
    const r = createRepo([
      { message: "create", files: { "a.js": "start();\nconst limit = 10;\nend();\n" } },
    ]);
    repos.push(r);
    expect(
      await mapToCommittedLine({
        root: r.path,
        path: "a.js",
        line: 2,
        text: "start();\nconst limit = 50;\nend();\n",
      }),
    ).toEqual({ status: "uncommitted", reason: "modified" });
  });

  it("calls a new line typed over a blank or unrelated line added, not modified", async () => {
    const r = createRepo([{ message: "create", files: { "a.rb": "end\n\ndef current_user\n" } }]);
    repos.push(r);
    const text = "end\ndef lol\nend\ndef current_user\n";

    expect(await mapToCommittedLine({ root: r.path, path: "a.rb", line: 2, text })).toEqual({
      status: "uncommitted",
      reason: "added",
    });
    expect(await mapToCommittedLine({ root: r.path, path: "a.rb", line: 4, text })).toEqual({
      status: "committed",
      line: 3,
    });
  });

  it("calls a line modified when the text it replaced resembles it", async () => {
    expect(await map("a\nb\nc  \nd\ne\n", 3)).toEqual({
      status: "uncommitted",
      reason: "modified",
    });
    expect(await map("a\nb\nclient_id = 3\nd\ne\n", 3)).toEqual({
      status: "uncommitted",
      reason: "added",
    });
  });

  it("handles several changes at once", async () => {
    const text = "a\nNEW\nb\nd\ne\nTAIL\n";
    expect(await map(text, 3)).toEqual({ status: "committed", line: 2 });
    expect(await map(text, 4)).toEqual({ status: "committed", line: 4 });
    expect(await map(text, 5)).toEqual({ status: "committed", line: 5 });
  });

  it("reports files that git does not know", async () => {
    const r = repo();
    expect(
      await mapToCommittedLine({ root: r.path, path: "src/new.txt", line: 1, text: "x\n" }),
    ).toEqual({ status: "untracked" });
  });
});

describe("mapLine and parseHunks", () => {
  it("reads git's short hunk headers, where a missing count means 1", () => {
    const hunks = parseHunks(["@@ -1,0 +2 @@ a", "+NEW", "@@ -3 +3,0 @@ b", "-c"].join("\n"));
    expect(hunks).toEqual([
      { oldStart: 1, oldCount: 0, newStart: 2, newCount: 1, removed: [] },
      { oldStart: 3, oldCount: 1, newStart: 3, newCount: 0, removed: ["c"] },
    ]);
    expect(mapLine(hunks, 4)).toEqual({ status: "committed", line: 4 });
  });

  it("maps every line when there are no changes", () => {
    expect(mapLine([], 42)).toEqual({ status: "committed", line: 42 });
  });
});
