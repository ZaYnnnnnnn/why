import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type TestRepo } from "@why/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, parseTarget, run, type Io } from "../src/cli.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function repo(): TestRepo {
  const r = createRepo([
    {
      message: "create config",
      files: { "src/config.ts": "export const a = 1;\nexport const limit = 10;\n" },
      author: { name: "Ada", email: "ada@example.com" },
      date: "2019-03-04T10:00:00Z",
    },
    {
      message: "raise limit for big uploads",
      files: { "src/config.ts": "export const a = 1;\nexport const limit = 50;\n" },
      author: { name: "Grace", email: "grace@example.com" },
      date: "2021-07-19T10:00:00Z",
    },
  ]);
  cleanups.push(r.cleanup);
  return r;
}

function fakeIo(cwd: string, overrides: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    cwd,
    env: {},
    ...overrides,
  };
  return { io, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("why CLI", () => {
  it("prints the line's history as a readable timeline", async () => {
    const r = repo();
    const { io, stdout } = fakeIo(r.path);

    const code = await run(["src/config.ts:2"], io);

    expect(code).toBe(EXIT_OK);
    expect(stdout()).toBe(
      [
        "src/config.ts:2",
        "  export const limit = 50;",
        "",
        "2 changes, newest first",
        "",
        `${r.commits[1]!.slice(0, 7)}  2021-07-19  Grace`,
        "  raise limit for big uploads",
        "  changed at line 2",
        "  - export const limit = 10;",
        "  + export const limit = 50;",
        "",
        `${r.commits[0]!.slice(0, 7)}  2019-03-04  Ada`,
        "  create config",
        "  added at line 2",
        "  + export const limit = 10;",
        "",
      ].join("\n"),
    );
  });

  it("shows the old file name on steps from before a rename", async () => {
    const r = createRepo([
      { message: "create", files: { "util.js": "value = 1\n" } },
      { message: "rename", renames: { "util.js": "lib/helpers.js" } },
      { message: "edit", files: { "lib/helpers.js": "value = 2\n" } },
    ]);
    cleanups.push(r.cleanup);
    const { io, stdout } = fakeIo(r.path);

    expect(await run(["lib/helpers.js:1"], io)).toBe(EXIT_OK);
    expect(stdout()).toContain("  changed at line 1\n");
    expect(stdout()).toContain("  added at line 1 in util.js\n");
  });

  it("prints JSON with --json", async () => {
    const r = repo();
    const { io, stdout } = fakeIo(r.path);

    expect(await run(["src/config.ts:2", "--json"], io)).toBe(EXIT_OK);

    const history = JSON.parse(stdout());
    expect(history.path).toBe("src/config.ts");
    expect(history.changes).toHaveLength(2);
    expect(history.changes[0].commit).toBe(r.commits[1]);
  });

  it("runs against another folder with --repo", async () => {
    const r = repo();
    const elsewhere = mkdtempSync(join(tmpdir(), "why-cwd-"));
    cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    const { io, stdout } = fakeIo(elsewhere);

    expect(await run(["src/config.ts:1", "--repo", r.path], io)).toBe(EXIT_OK);
    expect(stdout()).toContain("1 change, newest first");
  });

  it("starts from an older revision with --rev", async () => {
    const r = repo();
    const { io, stdout } = fakeIo(r.path);

    expect(await run(["src/config.ts:2", "--rev", r.commits[0]!], io)).toBe(EXIT_OK);
    expect(stdout()).toContain(`src/config.ts:2 at ${r.commits[0]}`);
    expect(stdout()).toContain("export const limit = 10;");
  });

  it("uses colour only on a terminal without NO_COLOR", async () => {
    const r = repo();
    const tty = fakeIo(r.path);
    tty.io.stdout.isTTY = true;
    await run(["src/config.ts:2"], tty.io);
    expect(tty.stdout()).toContain("\x1b[");

    const noColor = fakeIo(r.path, { env: { NO_COLOR: "1" } });
    noColor.io.stdout.isTTY = true;
    await run(["src/config.ts:2"], noColor.io);
    expect(noColor.stdout()).not.toContain("\x1b[");
  });

  it("shows help", async () => {
    const { io, stdout } = fakeIo(process.cwd());
    expect(await run(["--help"], io)).toBe(EXIT_OK);
    expect(stdout()).toContain("Usage: why <file>:<line>");
  });

  it("rejects bad usage with exit code 2", async () => {
    const r = repo();
    for (const args of [[], ["src/config.ts"], ["a.ts:1", "b.ts:2"], ["--nope", "a.ts:1"]]) {
      const { io, stderr } = fakeIo(r.path);
      expect(await run(args, io)).toBe(EXIT_USAGE);
      expect(stderr()).toMatch(/^why: /);
    }
  });

  it("reports a missing file with exit code 1", async () => {
    const r = repo();
    const { io, stderr } = fakeIo(r.path);

    expect(await run(["missing.ts:1"], io)).toBe(EXIT_FAILURE);
    expect(stderr()).toBe("why: missing.ts does not exist at HEAD\n");
  });

  it("works as a real command", () => {
    const r = repo();
    const output = execFileSync(process.execPath, [MAIN, "src/config.ts:2", "--json"], {
      cwd: r.path,
      encoding: "utf8",
    });
    expect(JSON.parse(output).changes).toHaveLength(2);
  });
});

describe("parseTarget", () => {
  it("splits on the last colon so paths may contain colons", () => {
    expect(parseTarget("src/a:b.ts:12")).toEqual({ file: "src/a:b.ts", line: 12 });
  });

  it("rejects targets without a numeric line", () => {
    for (const value of ["a.ts", "a.ts:", ":3", "a.ts:x", "a.ts:-1", "a.ts:1.5"]) {
      expect(parseTarget(value)).toBeUndefined();
    }
  });
});
