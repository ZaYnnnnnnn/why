import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { lookUpLine } from "../src/lookup.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const CONTENT = "start();\nconst limit = 10;\nend();\n";

function repo(remote?: string): TestRepo {
  const r = createRepo([
    { message: "create", files: { "src/app.js": "start();\nconst limit = 5;\nend();\n" } },
    { message: "raise limit (#7)", files: { "src/app.js": CONTENT } },
  ]);
  cleanups.push(r.cleanup);
  if (remote) r.git("remote", "add", "origin", remote);
  return r;
}

function env() {
  const dir = mkdtempSync(join(tmpdir(), "why-vscode-cache-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return { XDG_CACHE_HOME: dir };
}

const offline = (async () => {
  throw new Error("unexpected network call");
}) as typeof fetch;

describe("lookUpLine", () => {
  it("traces a line from the editor's file path", async () => {
    const r = repo();
    const result = await lookUpLine({
      filePath: join(r.path, "src/app.js"),
      line: 2,
      text: CONTENT,
      env: env(),
      fetch: offline,
    });

    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.history.changes.map((c) => c.subject)).toEqual(["raise limit (#7)", "create"]);
    expect(result.editorLine).toBe(2);
  });

  it("maps a line shifted by unsaved edits back to its committed line", async () => {
    const r = repo();
    const result = await lookUpLine({
      filePath: join(r.path, "src/app.js"),
      line: 4,
      text: "// new header\n// more\nstart();\nconst limit = 10;\nend();\n",
      env: env(),
      fetch: offline,
    });

    expect(result).toMatchObject({ status: "found", editorLine: 4 });
    if (result.status === "found") expect(result.history.line).toBe(2);
  });

  it("says a freshly typed line is not committed yet", async () => {
    const r = repo();
    const result = await lookUpLine({
      filePath: join(r.path, "src/app.js"),
      line: 2,
      text: "start();\nconst brandNew = 1;\nconst limit = 10;\nend();\n",
      env: env(),
      fetch: offline,
    });
    expect(result).toEqual({ status: "uncommitted", editorLine: 2, reason: "added" });
  });

  it("says a file that git does not know has no history", async () => {
    const r = repo();
    const result = await lookUpLine({
      filePath: join(r.path, "src/new.js"),
      line: 1,
      text: "x\n",
      env: env(),
      fetch: offline,
    });
    expect(result).toEqual({ status: "untracked", editorLine: 1 });
  });

  it("reports a folder outside git as a failure, not a crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "why-no-git-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const result = await lookUpLine({
      filePath: join(dir, "a.js"),
      line: 1,
      text: "",
      env: env(),
      fetch: offline,
    });
    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/not found|git repository/i),
    });
  });

  it("adds GitHub evidence when the repository is on GitHub", async () => {
    const r = repo("git@github.com:acme/app.git");
    const calls: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      const { pathname } = new URL(url);
      calls.push(
        `${pathname} ${(init?.headers as Record<string, string>)["Authorization"] ?? "anonymous"}`,
      );
      return new Response(pathname.endsWith("/pulls") ? "[]" : "{}", {
        status: pathname.endsWith("/pulls") ? 200 : 404,
      });
    }) as typeof globalThis.fetch;

    const result = await lookUpLine({
      filePath: join(r.path, "src/app.js"),
      line: 2,
      text: CONTENT,
      token: "editor-token",
      env: env(),
      fetch,
    });

    expect(result.status).toBe("found");
    if (result.status === "found") expect("github" in result.history).toBe(true);
    expect(calls[0]).toMatch(/^\/repos\/acme\/app\/commits\/[0-9a-f]+\/pulls Bearer editor-token$/);
  });
});
