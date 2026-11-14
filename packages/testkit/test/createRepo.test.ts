import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepo, type CommitSpec, type TestRepo } from "../src/index.ts";

const repos: TestRepo[] = [];

function make(history: CommitSpec[]): TestRepo {
  const repo = createRepo(history);
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

describe("createRepo", () => {
  it("creates one commit per step, in order", () => {
    const repo = make([
      { message: "add greeting", files: { "src/hello.ts": "hello\n" } },
      { message: "change greeting", files: { "src/hello.ts": "hello world\n" } },
    ]);

    expect(repo.commits).toHaveLength(2);
    expect(repo.git("log", "--reverse", "--format=%s")).toBe("add greeting\nchange greeting");
    expect(readFileSync(join(repo.path, "src/hello.ts"), "utf8")).toBe("hello world\n");
  });

  it("produces the same commit hashes for the same history", () => {
    const history: CommitSpec[] = [
      { message: "first", files: { "a.txt": "one\n" } },
      { message: "second", files: { "a.txt": "two\n" } },
    ];

    expect(make(history).commits).toEqual(make(history).commits);
  });

  it("records renames so git can detect them", () => {
    const repo = make([
      { message: "add util", files: { "src/util.ts": "export const x = 1;\n" } },
      { message: "move util", renames: { "src/util.ts": "lib/helpers/util.ts" } },
    ]);

    const changes = repo.git("show", "--name-status", "-M", "--format=", repo.commits[1]!);
    expect(changes).toMatch(/^R100\tsrc\/util\.ts\tlib\/helpers\/util\.ts$/);
    expect(existsSync(join(repo.path, "src/util.ts"))).toBe(false);
  });

  it("deletes a file when its content is null", () => {
    const repo = make([
      { message: "add", files: { "gone.txt": "bye\n", "kept.txt": "hi\n" } },
      { message: "remove", files: { "gone.txt": null } },
    ]);

    expect(repo.git("ls-files")).toBe("kept.txt");
  });

  it("uses the given author and date", () => {
    const repo = make([
      {
        message: "custom",
        files: { "a.txt": "a\n" },
        author: { name: "Ada", email: "ada@example.com" },
        date: "2015-06-01T12:00:00Z",
      },
    ]);

    const timestamp = Date.parse("2015-06-01T12:00:00Z") / 1000;
    expect(repo.git("log", "-1", "--format=%an <%ae> %at")).toBe(
      `Ada <ada@example.com> ${timestamp}`,
    );
  });

  it("refuses paths outside the repo", () => {
    expect(() => createRepo([{ message: "bad", files: { "../escape.txt": "x" } }])).toThrow(
      /escapes the test repo/,
    );
  });
});
