import { WhyError } from "./errors.ts";
import { parseDiffPath, readFileAt } from "./files.ts";
import { findMovedFrom, normalize, similarity, type SourceLocation } from "./findMovedFrom.ts";
import { runGit } from "./git.ts";
import { findRepoRoot, toRepoPath } from "./repo.ts";

export interface TraceOptions {
  file: string;
  line: number;
  cwd?: string;
  rev?: string;
  minLineSimilarity?: number;
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
const MAX_STEPS = 50;
const NARROW_THRESHOLD = 0.5;
export const DEFAULT_MIN_LINE_SIMILARITY = 0.5;

export async function traceLine(options: TraceOptions): Promise<LineHistory> {
  const {
    file,
    line,
    cwd = process.cwd(),
    rev = "HEAD",
    minLineSimilarity = DEFAULT_MIN_LINE_SIMILARITY,
  } = options;

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
    changes: await followLine(root, { rev, path, line }, minLineSimilarity),
  };
}

interface Position {
  rev: string;
  path: string;
  line: number;
}

async function followLine(
  root: string,
  start: Position,
  minLineSimilarity: number,
): Promise<LineChange[]> {
  const changes: LineChange[] = [];
  const visited = new Set<string>();
  let position: Position | undefined = start;

  for (let steps = 0; position && steps < MAX_STEPS; steps += 1) {
    const key = `${position.rev}:${position.path}:${position.line}`;
    if (visited.has(key)) break;
    visited.add(key);
    position = await followSegment(root, position, changes, minLineSimilarity);
  }

  return changes;
}

async function followSegment(
  root: string,
  position: Position,
  changes: LineChange[],
  minLineSimilarity: number,
): Promise<Position | undefined> {
  const entries = parseEntries(await lineLog(root, position));

  for (const entry of entries) {
    const { change } = entry;
    if (change.before.length <= 1) {
      changes.push(change);
      if (replacedUnrelatedLine(change, minLineSimilarity)) return undefined;
      continue;
    }

    const narrowed = narrowToOneLine(entry, Math.max(NARROW_THRESHOLD, minLineSimilarity));
    if (!narrowed) {
      changes.push(change);
      return undefined;
    }
    changes.push({ ...change, before: [narrowed.text] });
    return { rev: `${change.commit}^`, path: entry.oldPath, line: narrowed.lineNumber };
  }

  const origin = entries.at(-1)?.change;
  if (!origin || origin.kind !== "added") return undefined;

  const move = await findMovedFrom(root, {
    commit: origin.commit,
    path: origin.path,
    lineNumber: origin.lineNumber,
    text: origin.after[0] ?? "",
  });

  if (move.status === "none") return undefined;
  if (move.status === "ambiguous") {
    changes[changes.length - 1] = { ...origin, possibleOrigins: move.candidates };
    return undefined;
  }

  changes[changes.length - 1] = {
    ...origin,
    kind: "moved",
    before: [move.text],
    movedFrom: move.from,
  };
  return { rev: `${origin.commit}^`, path: move.from.path, line: move.from.lineNumber };
}

function replacedUnrelatedLine(change: LineChange, minLineSimilarity: number): boolean {
  const [before] = change.before;
  if (before === undefined || minLineSimilarity <= 0) return false;
  return similarity(normalize(before), normalize(change.after[0] ?? "")) < minLineSimilarity;
}

function narrowToOneLine(
  entry: LogEntry,
  threshold: number,
): { text: string; lineNumber: number } | undefined {
  const target = normalize(entry.change.after[0] ?? "");
  let best: { text: string; lineNumber: number; score: number } | undefined;

  entry.change.before.forEach((text, index) => {
    const score = similarity(normalize(text), target);
    const lineNumber = entry.beforeLineNumbers[index];
    if (lineNumber !== undefined && (!best || score > best.score)) {
      best = { text, lineNumber, score };
    }
  });

  if (!best || best.score < threshold) return undefined;
  return { text: best.text, lineNumber: best.lineNumber };
}

function lineLog(root: string, { rev, path, line }: Position): Promise<string> {
  return runGit(root, [
    "log",
    `-L${line},${line}:${path}`,
    `--format=${LOG_FORMAT}`,
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    rev,
  ]);
}

export function parseLineLog(output: string): LineChange[] {
  return parseEntries(output).map((entry) => entry.change);
}

interface LogEntry {
  change: LineChange;
  oldPath: string;
  beforeLineNumbers: number[];
}

function parseEntries(output: string): LogEntry[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map(parseRecord);
}

function parseRecord(record: string): LogEntry {
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
    change: {
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
    },
    oldPath: hunk.oldPath || hunk.path,
    beforeLineNumbers: hunk.beforeLineNumbers,
  };
}

interface ParsedDiff {
  path: string;
  oldPath: string;
  lineNumber: number;
  before: string[];
  beforeLineNumbers: number[];
  after: string[];
}

function parseDiff(diff: string): ParsedDiff {
  const result: ParsedDiff = {
    path: "",
    oldPath: "",
    lineNumber: 0,
    before: [],
    beforeLineNumbers: [],
    after: [],
  };
  let inHunk = false;
  let oldLine = 0;

  for (const raw of diff.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      if (!inHunk) result.lineNumber = Number(header[3]);
      inHunk = true;
      oldLine = Number(header[1]);
      continue;
    }

    if (!inHunk) {
      if (raw.startsWith("+++ ")) result.path = parseDiffPath(raw);
      else if (raw.startsWith("--- ")) result.oldPath = parseDiffPath(raw);
      continue;
    }

    if (raw.startsWith("-")) {
      result.before.push(raw.slice(1));
      result.beforeLineNumbers.push(oldLine);
      oldLine += 1;
    } else if (raw.startsWith("+")) {
      result.after.push(raw.slice(1));
    } else if (raw.startsWith(" ")) {
      oldLine += 1;
    }
  }

  if (result.path === "") result.path = result.oldPath;
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
