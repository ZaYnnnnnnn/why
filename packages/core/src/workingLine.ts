import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { WhyError } from "./errors.ts";
import { runGit } from "./git.ts";

const execFileAsync = promisify(execFile);

export type WorkingLine =
  | { status: "committed"; line: number }
  | { status: "uncommitted"; reason: "added" | "modified" }
  | { status: "untracked" };

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  removed: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export async function mapToCommittedLine(options: {
  root: string;
  path: string;
  line: number;
  text: string;
  rev?: string;
}): Promise<WorkingLine> {
  const { root, path, line, text, rev = "HEAD" } = options;

  let committed: string;
  try {
    committed = await runGit(root, ["show", `${rev}:${path}`]);
  } catch {
    return { status: "untracked" };
  }
  if (committed === text) return { status: "committed", line };

  return mapLine(parseHunks(await diffTexts(committed, text)), line);
}

export function mapLine(hunks: Hunk[], line: number): WorkingLine {
  let delta = 0;
  for (const hunk of hunks) {
    const { oldCount, newStart, newCount } = hunk;
    if (newCount > 0 && line >= newStart && line < newStart + newCount) {
      return { status: "uncommitted", reason: oldCount === 0 ? "added" : "modified" };
    }
    const before = newCount > 0 ? newStart + newCount - 1 < line : newStart < line;
    if (!before) break;
    delta += oldCount - newCount;
  }
  return { status: "committed", line: line + delta };
}

export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const raw of diff.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      hunks.push({
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        removed: [],
      });
    } else if (raw.startsWith("-") && !raw.startsWith("---") && hunks.length > 0) {
      hunks.at(-1)!.removed.push(raw.slice(1));
    }
  }
  return hunks;
}

async function diffTexts(before: string, after: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "why-diff-"));
  try {
    const a = join(dir, "committed");
    const b = join(dir, "working");
    writeFileSync(a, before);
    writeFileSync(b, after);
    try {
      await execFileAsync(
        "git",
        ["diff", "--no-index", "--no-color", "--no-ext-diff", "-U0", "--", a, b],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      );
      return "";
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      if (failure.code === 1 && typeof failure.stdout === "string") return failure.stdout;
      throw new WhyError("GIT_FAILED", `git diff failed: ${(failure.stderr ?? "").trim()}`, {
        cause: error,
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
