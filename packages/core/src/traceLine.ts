import { WhyError } from "./errors.ts";
import { parseDiffPath, readFileAt } from "./files.ts";
import { findMovedFrom, type SourceLocation } from "./findMovedFrom.ts";
import { runGit } from "./git.ts";
import { findRepoRoot, toRepoPath } from "./repo.ts";

export interface TraceOptions {
  file: string;
  line: number;
  cwd?: string;
  rev?: string;
}

export type ChangeKind = "added" | "modified" | "moved";

export interface LineChange {
  commit: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
  path: string;
  lineNumber: number;
  kind: ChangeKind;
  before: string[];
  after: string[];
  movedFrom?: SourceLocation;
  possibleOrigins?: SourceLocation[];
}

export interface LineHistory {
  root: string;
  path: string;
  line: number;
  rev: string;
  content: string;
  changes: LineChange[];
}

const RECORD = "\x1e";
const FIELD = "\x1f";
const LOG_FORMAT = `${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s${FIELD}%b${FIELD}`;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_MOVES = 20;

export async function traceLine(options: TraceOptions): Promise<LineHistory> {
  const { file, line, cwd = process.cwd(), rev = "HEAD" } = options;

  if (!Number.isInteger(line) || line < 1) {
    throw new WhyError("INVALID_ARGUMENT", `Line must be a whole number of 1 or more, got ${line}`);
  }
  if (rev === "" || rev.startsWith("-")) {
    throw new WhyError("INVALID_ARGUMENT", `Invalid revision: ${rev}`);
  }

  const root = await findRepoRoot(cwd);
  const path = toRepoPath(root, file, cwd);

  await verifyRevision(root, rev);
  const lines = await readLines(root, rev, path);

  if (line > lines.length) {
    throw new WhyError(
      "LINE_OUT_OF_RANGE",
      `${path} has ${lines.length} line${lines.length === 1 ? "" : "s"} at ${rev}, so line ${line} does not exist`,
    );
  }

  return {
    root,
    path,
    line,
    rev,
    content: lines[line - 1] ?? "",
    changes: await followLine(root, { rev, path, line }),
  };
}

interface Position {
  rev: string;
  path: string;
  line: number;
}

async function followLine(root: string, start: Position): Promise<LineChange[]> {
  const changes: LineChange[] = [];
  const visited = new Set<string>();
  let position = start;

  for (let moves = 0; ; moves += 1) {
    const segment = parseLineLog(await lineLog(root, position));
    changes.push(...segment);

    const origin = segment.at(-1);
    if (!origin || origin.kind !== "added" || moves >= MAX_MOVES || visited.has(origin.commit)) {
      return changes;
    }
    visited.add(origin.commit);

    const move = await findMovedFrom(root, {
      commit: origin.commit,
      path: origin.path,
      lineNumber: origin.lineNumber,
      text: origin.after[0] ?? "",
    });

    if (move.status === "none") return changes;
    if (move.status === "ambiguous") {
      changes[changes.length - 1] = { ...origin, possibleOrigins: move.candidates };
      return changes;
    }

    changes[changes.length - 1] = {
      ...origin,
      kind: "moved",
      before: [move.text],
      movedFrom: move.from,
    };
    position = { rev: `${origin.commit}^`, path: move.from.path, line: move.from.lineNumber };
  }
}

function lineLog(root: string, { rev, path, line }: Position): Promise<string> {
  return runGit(root, [
    "log",
    `-L${line},${line}:${path}`,
    `--format=${LOG_FORMAT}`,
    "--no-color",
    "--no-ext-diff",
    rev,
  ]);
}

export function parseLineLog(output: string): LineChange[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map(parseRecord);
}

function parseRecord(record: string): LineChange {
  const fields = record.split(FIELD);
  if (fields.length < 7) {
    throw new WhyError("GIT_FAILED", "Unexpected git log output");
  }
  const [commit, authorName, authorEmail, timestamp, subject, body, diff] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const hunk = parseDiff(diff);

  return {
    commit,
    authorName,
    authorEmail,
    date: new Date(Number(timestamp) * 1000).toISOString(),
    subject,
    body: body.trim(),
    path: hunk.path,
    lineNumber: hunk.lineNumber,
    kind: hunk.before.length === 0 ? "added" : "modified",
    before: hunk.before,
    after: hunk.after,
  };
}

interface ParsedDiff {
  path: string;
  lineNumber: number;
  before: string[];
  after: string[];
}

function parseDiff(diff: string): ParsedDiff {
  const result: ParsedDiff = { path: "", lineNumber: 0, before: [], after: [] };
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (!inHunk) {
      const header = HUNK_HEADER.exec(raw);
      if (header) {
        inHunk = true;
        result.lineNumber = Number(header[3]);
      } else if (raw.startsWith("+++ ")) {
        result.path = parseDiffPath(raw);
      } else if (raw.startsWith("--- ") && result.path === "") {
        result.path = parseDiffPath(raw);
      }
      continue;
    }

    if (HUNK_HEADER.test(raw)) continue;
    if (raw.startsWith("-")) result.before.push(raw.slice(1));
    else if (raw.startsWith("+")) result.after.push(raw.slice(1));
  }

  return result;
}

async function verifyRevision(root: string, rev: string): Promise<void> {
  try {
    await runGit(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  } catch (error) {
    throw new WhyError("INVALID_ARGUMENT", `Unknown revision: ${rev}`, { cause: error });
  }
}

async function readLines(root: string, rev: string, path: string): Promise<string[]> {
  try {
    await runGit(root, ["cat-file", "-e", `${rev}:${path}`]);
  } catch (error) {
    throw new WhyError("FILE_NOT_FOUND", `${path} does not exist at ${rev}`, { cause: error });
  }
  return readFileAt(root, rev, path);
}
