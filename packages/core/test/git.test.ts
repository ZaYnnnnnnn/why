import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { findRepoRoot, runGit, toRepoPath, WhyError } from "../src/index.ts";

const cleanups: Array<() => void> = [];

function repo(): TestRepo {
  const r = createRepo([
    { message: "add file", files: { "src/app/main.ts": "one\ntwo\n" } },
    { message: "$(echo injected) `whoami` ; rm -rf /", files: { "src/app/main.ts": "one\n" } },
  ]);
  cleanups.push(r.cleanup);
  return r;
}

function emptyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "why-nogit-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("runGit", () => {
  it("returns git's output", async () => {
    const r = repo();
    const out = await runGit(r.path, ["rev-list", "--count", "HEAD"]);
    expect(out.trim()).toBe("2");
  });

  it("passes arguments literally, never through a shell", async () => {
    const r = repo();
    const subject = await runGit(r.path, ["log", "-1", "--format=%s"]);
    expect(subject.trim()).toBe("$(echo injected) `whoami` ; rm -rf /");
  });

  it("reports a folder that is not a repository", async () => {
    await expect(runGit(emptyDir(), ["status"])).rejects.toMatchObject({
      name: "WhyError",
      code: "NOT_A_REPO",
    });
  });

  it("wraps other git failures with the first stderr line", async () => {
    const r = repo();
    const failure = runGit(r.path, ["show", "does-not-exist"]);
    await expect(failure).rejects.toBeInstanceOf(WhyError);
    await expect(failure).rejects.toMatchObject({ code: "GIT_FAILED" });
    await expect(failure).rejects.toThrow(/^git show failed: /);
  });
});

describe("findRepoRoot", () => {
  it("finds the root from a nested folder", async () => {
    const r = repo();
    const root = await findRepoRoot(join(r.path, "src", "app"));
    expect(await findRepoRoot(r.path)).toBe(root);
    expect(root.endsWith(r.path.split("/").pop()!)).toBe(true);
  });

  it("finds the root from a file path", async () => {
    const r = repo();
    expect(await findRepoRoot(join(r.path, "src", "app", "main.ts"))).toBe(
      await findRepoRoot(r.path),
    );
  });

  it("rejects a path that does not exist", async () => {
    await expect(findRepoRoot(join(emptyDir(), "missing"))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("rejects a folder outside any repository", async () => {
    await expect(findRepoRoot(emptyDir())).rejects.toMatchObject({ code: "NOT_A_REPO" });
  });
});

describe("toRepoPath", () => {
  it("turns a path relative to the current folder into a repo path", async () => {
    const r = repo();
    const root = await findRepoRoot(r.path);
    const cwd = join(r.path, "src");
    expect(toRepoPath(root, "app/main.ts", cwd)).toBe("src/app/main.ts");
  });

  it("accepts paths for files that only exist in history", async () => {
    const r = repo();
    const root = await findRepoRoot(r.path);
    mkdirSync(join(r.path, "empty"));
    expect(toRepoPath(root, "../deleted.ts", join(r.path, "empty"))).toBe("deleted.ts");
  });

  it("rejects paths that leave the repository", async () => {
    const r = repo();
    const root = await findRepoRoot(r.path);
    expect(() => toRepoPath(root, "../../etc/passwd", r.path)).toThrow(/outside the repository/);
  });
});
